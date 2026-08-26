/**
 * @lyxx/dsh-session-autotitle/title — 全消息会话标题提供方。
 *
 * 原位替换基线 first-prompt provider（同一 service 插槽）：
 * - 输入 = 会话中全部用户消息（source.kind === 'user'，与基线一致），
 *   预算内取「首条锚点 + 最近窗口」；整段超预算时截断首条。
 * - 标题调用请求 reasoningEffort 'off'（路由支持时）：在 pi-ai 路由上把
 *   思考关掉（配合宿主半区对 llm-pi-ai 的接线自补齐），64/256 token 预算
 *   不再被思考吞掉。路由不支持 off 时退回不带档位的调用。
 * - 首条提示词时刻 messages 只有首条（service 的 throughSeq 边界），
 *   行为与基线一致；之后的 /autotitle 与 handoff 触发覆盖全部消息。
 */
import { Buffer } from 'node:buffer'
import { BlockAssembler, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS, deadline } from '@deepseek-ai/dsh-timeout'
import { SessionTitleProviderId, normalizeSessionTitle } from '@deepseek-ai/dsh-session-title'

export const name = '@lyxx/dsh-session-autotitle/title'
export const inject = ['sessionTitle', 'llm']

const TIMEOUT_CODE = 'SESSION_AUTOTITLE_TIMEOUT'
const CONFIG_KEYS = new Set([
  'targetWords',
  'targetCjkCharacters',
  'maxInputBytes',
  'maxOutputTokens',
  'timeoutMs',
  'provider',
  'model',
])

function assertPositiveInteger(key, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`session-autotitle: ${key} must be a positive integer`)
  }
}

/** 校验组合行配置；键与基线同名，值语义见 cordis.patch.yml。 */
function resolveConfig(config) {
  if (config === null || typeof config !== 'object') {
    throw new Error('session-autotitle: configuration is required')
  }
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`session-autotitle: unknown config key "${key}"`)
  }
  assertPositiveInteger('targetWords', config.targetWords)
  assertPositiveInteger('targetCjkCharacters', config.targetCjkCharacters)
  assertPositiveInteger('maxInputBytes', config.maxInputBytes)
  assertPositiveInteger('maxOutputTokens', config.maxOutputTokens)
  assertPositiveInteger('timeoutMs', config.timeoutMs)
  if (config.timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`session-autotitle: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  const hasProvider = config.provider !== undefined
  if (hasProvider !== (config.model !== undefined)) {
    throw new Error('session-autotitle: provider and model must be supplied together')
  }
  if (
    hasProvider &&
    (typeof config.provider !== 'string' || config.provider.length === 0 ||
      typeof config.model !== 'string' || config.model.length === 0)
  ) {
    throw new Error('session-autotitle: provider and model overrides must be non-empty strings')
  }
  return deepFreeze({ ...config })
}

/** 语言指令（与基线同风格，追加 80 字节长度约定）。language 为空 → 跟随消息语言。 */
function systemPrompt(config, language) {
  return [
    'Create a concise title for an AI coding-assistant session from the supplied human messages.',
    'Return only the title on one line, in plain text of natural language, with no quotes, prefix, explanation, Markdown, XML, or terminal control codes. No code is allowed.',
    language === undefined ? 'Use the language of the messages.' : `Write the title in ${language}.`,
    `Aim for at most ${config.targetWords} words in non-CJK languages or ${config.targetCjkCharacters} CJK characters; the title must stay under 80 UTF-8 bytes.`,
  ].join('\n')
}

/**
 * 读取设置的标题语言（llm-pi-ai 用户层顶层键 titleLanguage —— 与
 * @hytime/dsh-thinking-effort 的 subagentEffort 同一惯例：插件无法注册
 * 新命名空间，schema 忽略该键但原样持久化，故从 describe 的 user 层读）。
 * 空 / 'auto' / 读取失败 → undefined（跟随消息语言，行为同今日）。
 */
function readTitleLanguage(ctx) {
  let settings
  if (typeof ctx.get === 'function') settings = ctx.get('settings')
  else settings = ctx.settings
  if (settings === null || settings === undefined || typeof settings.describe !== 'function') return undefined
  let namespaces
  try {
    namespaces = settings.describe()
  } catch {
    return undefined
  }
  if (!Array.isArray(namespaces)) return undefined
  const ns = namespaces.find((entry) => entry !== null && typeof entry === 'object' && entry.ns === 'llm-pi-ai')
  const user = ns !== undefined && ns.user !== null && typeof ns.user === 'object' ? ns.user : {}
  const value = user.titleLanguage
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'auto') return undefined
  return trimmed
}

/** 以 JSON 数组框定消息，用户文本无法破坏结构分隔。 */
function frameMessages(messages) {
  return `Generate the session title from this JSON array of human messages:\n${JSON.stringify(messages)}`
}

/** 终局原因 → 辅助调用失败（与基线语义一致）。 */
function finishError(finish) {
  switch (finish.kind) {
    case 'stop':
      return
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message)
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('session-autotitle: title output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('session-autotitle: title model unexpectedly requested a tool')
    default:
      return new Error(`session-autotitle: unsupported finish reason "${String(finish.kind)}"`)
  }
}

/**
 * 消息选择：预算内优先全部；否则「首条锚点 + 能放下的最近窗口」；
 * 首条自身超预算时按比例截断首条文本。返回结果保证框定后 ≤ maxBytes
 * （截断分支可能例外，由调用方统一校验）。
 */
function selectMessages(all, maxBytes) {
  const fits = (selection) => Buffer.byteLength(frameMessages(selection), 'utf8') <= maxBytes
  if (fits(all)) return all
  const first = all[0]
  const rest = all.slice(1)
  for (let k = rest.length; k >= 1; k--) {
    const selection = [first, ...rest.slice(rest.length - k)]
    if (fits(selection)) return selection
  }
  let text = first.text
  while (text.length > 0 && Buffer.byteLength(frameMessages([{ seq: first.seq, text }]), 'utf8') > maxBytes) {
    text = text.slice(0, Math.floor(text.length * 0.8))
  }
  if (text.length === 0) {
    throw new Error('session-autotitle: the first user message alone exceeds maxInputBytes')
  }
  return [{ seq: first.seq, text }]
}

/**
 * 标题调用档位：路由声明支持 'off' 时请求之（pi-ai 路由 → 线上关思考）；
 * UNSUPPORTED_REASONING_EFFORT 时退回不带档位（其余适配器对 off 无害）。
 */
async function resolveEffort(llm, route) {
  try {
    await llm.resolveCallConfig({ provider: route.provider, model: route.model, reasoningEffort: 'off' })
    return 'off'
  } catch (error) {
    if (error && error.code === 'UNSUPPORTED_REASONING_EFFORT') return undefined
    throw error
  }
}

/** 生成一次标题：选择 → 框定 → 关思考调用 → 归一化。 */
async function generate(config, ctx, request, providerId) {
  request.signal.throwIfAborted()
  const all = request.messages
  if (all.length === 0) throw new Error('session-autotitle: at least one source message is required')
  const selected = selectMessages(all, config.maxInputBytes)
  const framedInput = frameMessages(selected)
  const inputBytes = Buffer.byteLength(framedInput, 'utf8')
  if (inputBytes > config.maxInputBytes) {
    throw new Error(`session-autotitle: input is ${inputBytes} bytes, exceeding maxInputBytes ${config.maxInputBytes}`)
  }
  const route = config.provider !== undefined
    ? { provider: config.provider, model: config.model }
    : (request.route === undefined
        ? (() => {
            throw new Error('session-autotitle: no logged request route is available; configure provider and model together')
          })()
        : request.route)
  const effort = await resolveEffort(ctx.llm, route)
  request.signal.throwIfAborted()
  const messages = [
    createUserMessage({
      content: [{ type: 'text', text: framedInput }],
      source: { kind: 'plugin', plugin: 'dsh-session-autotitle' },
    }),
  ]
  const language = readTitleLanguage(ctx)
  const system = systemPrompt(config, language)
  const dl = deadline(request.signal, config.timeoutMs, TIMEOUT_CODE)
  try {
    // 载荷必须纯 JSON 可序列化（session 服务强校验）：language 为
    // undefined（未设置标题语言）时不得携带该键。
    const payload = {
      titleProvider: providerId,
      messageSeqs: selected.map((message) => message.seq),
      route,
      system,
      messages,
      maxTokens: config.maxOutputTokens,
    }
    if (language !== undefined) payload.language = language
    request.session.append('session/title-llm-request', payload)
    dl.signal.throwIfAborted()
    const options = deepFreeze({
      provider: route.provider,
      model: route.model,
      messages,
      system,
      maxTokens: config.maxOutputTokens,
      sessionId: request.session.id,
      purpose: 'session-title',
      signal: dl.signal,
      ...(effort === undefined ? {} : { reasoningEffort: effort }),
    })
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream(options)) {
      dl.signal.throwIfAborted()
      assembler.push(chunk)
    }
    dl.signal.throwIfAborted()
    const terminalError = finishError(assembler.finish)
    if (terminalError !== undefined) throw terminalError
    const blocks = assembler.blocks()
    if (blocks.some((block) => block.type === 'tool-call')) {
      throw new Error('session-autotitle: title output must contain text only')
    }
    const title = normalizeSessionTitle(
      blocks.filter((block) => block.type === 'text').map((block) => block.text).join(' '),
      Number.MAX_SAFE_INTEGER,
    )
    if (title.length === 0) throw new Error('session-autotitle: title model produced no text')
    return {
      title,
      messageSeqs: selected.map((message) => message.seq),
      model: route,
    }
  } finally {
    dl[Symbol.dispose]()
  }
}

export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const providerId = SessionTitleProviderId(name)
  ctx.effect(
    () =>
      ctx.sessionTitle.register({
        id: providerId,
        automatic: 'first-prompt',
        generate: (request) => generate(resolved, ctx, request, providerId),
      }),
    'session-autotitle: title provider',
  )
}
