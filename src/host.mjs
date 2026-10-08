/**
 * @lyxx/dsh-session-autotitle — 宿主半区（行 `session-autotitle`）：
 *
 * 1) /autotitle 命令：手动总结重命名。走 sessionTitle.refresh —— 有意
 *    覆盖用户钉住的标题（refresh 的 unpin 语义，与手动重命名同级）。
 *    失败 → 命令结果通道一行错误（会话内可见）；成功 → 标题原地更新。
 * 2) /handoff 手势钩子：用户在顶层会话里调用 handoff 技能（文本中出现
 *    /handoff 手势，与 dsh-tool-skill 的识别正则同形）时自动重命名；
 *    用户钉住的标题（source.kind === 'user'）跳过；失败只写宿主日志。
 * 3) llm-pi-ai 路由思考接线自补齐（幂等，挂载重试 + 设置变更触发）：
 *    a. 已声明 reasoningEfforts 但缺 'off' 档位的模型补 off: null；
 *    b. 推理模型且未配置思考 wire（thinkingFormat 未设置，或
 *       chat-template 但缺 enable_thinking）的模型，补
 *       chat_template_kwargs.enable_thinking = {$var: thinking.enabled}：
 *       主对话（有档位）→ true，标题调用（off）→ false。
 *    与 @hytime/dsh-thinking-effort 的档位补齐互不冲突（各管各的键）。
 *    DSH 0.2.0 起设置服务（entry-config 模型）移除了 get()，只经
 *    describe() 的 user 层读、mutate() 的 volatile 子路径写；旧
 *    namespace 模型经 get()/describe() 读、mutate() 写。两种模型
 *    双兼容（与 @hytime/dsh-thinking-effort 0.3.8 同法）。写入载荷
 *    只引用用户层自己的条目，不引解析值，避免把 schema 默认值
 *    （contextWindow/maxTokens/…）钉进用户文档。
 */
import { AsyncResource } from 'node:async_hooks'
import z from '@deepseek-ai/schemastery'

export const name = '@lyxx/dsh-session-autotitle'
export const inject = ['sessions', 'sessionTitle', 'commands', 'settings', 'timer']

/**
 * 插件自有设置（Loader 条目 `session-autotitle`，设置表单由此派生）：
 * DSH 0.1.7+ 从插件 Config schema 派生设置；0.2.0 的 entry-config 模型
 * 下设置写入只接受 volatile 路径，而 llm-pi-ai 只声明 providers ——
 * 旧「键挂在 llm-pi-ai 顶层」的惯例读不到也写不进，故移入本条目。
 * 根 volatile 使设置页 mutate() 可寻址任意字段。旧 namespace 模型
 * （0.1.6 及更早）不从此 schema 派生 section，客户端继续读写旧
 * llm-pi-ai 键（宿主侧读取有回退）。
 */
export const Config = z.object({
  titleLanguage: z.string().default(''),
  titleMaxBytes: z.number().step(1).min(1).max(80).default(80),
}).volatile()

const NS = 'llm-pi-ai'
/**
 * 与 dsh-tool-skill 的 SKILL_GESTURE 逐字同形（含 g 标志），逐文本块
 * matchAll 后取捕获组判定 —— 钩子触发条件与技能实际加载完全一致
 * （包括块边界语义：不跨块拼接）。
 */
const SKILL_GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g

function describe(error) {
  return error && error.message ? error.message : String(error)
}

export function apply(ctx) {
  const log = (...args) => console.log('[@lyxx/dsh-session-autotitle]', ...args)
  const warn = (...args) => console.warn('[@lyxx/dsh-session-autotitle]', ...args)

  // ── 1) /autotitle：手动总结重命名 ────────────────────────────────
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'autotitle',
        description: 'Summarize this session with the LLM and rename it',
        handler: (invocation) => {
          const session = invocation.agent.session
          return ctx.sessionTitle
            .refresh(session, invocation.signal)
            .then(
              (snapshot) =>
                snapshot === undefined
                  ? { kind: 'error', text: '自动重命名失败：会话中还没有可用的用户消息。' }
                  : { kind: 'success', text: `标题已更新为「${snapshot.title}」` },
            )
            .catch((error) => ({
              kind: 'error',
              text: `自动重命名失败：${describe(error)}`,
            }))
        },
      }),
    'session-autotitle: /autotitle command',
  )

  // ── 2) /handoff 手势 → 自动重命名（跳过用户钉住） ────────────────
  ctx.on('session/event', (session, event) => {
    try {
      if (event.type !== 'user/message') return
      if (event.data === null || typeof event.data !== 'object') return
      if (event.data.source === null || typeof event.data.source !== 'object' || event.data.source.kind !== 'user') return
      if (session.header !== null && session.header !== undefined && session.header.parentSession !== undefined) return
      const content = Array.isArray(event.data.content) ? event.data.content : []
      let gesture = false
      for (const block of content) {
        if (block === null || typeof block !== 'object' || block.type !== 'text' || typeof block.text !== 'string') continue
        for (const match of block.text.matchAll(SKILL_GESTURE)) {
          if (match[2] === 'handoff') {
            gesture = true
            break
          }
        }
        if (gesture) break
      }
      if (!gesture) return
      const current = ctx.sessionTitle.get(session)
      if (current !== undefined && current.source !== null && typeof current.source === 'object' && current.source.kind === 'user') {
        return // 用户手动钉住的标题不被 handoff 覆盖
      }
      void ctx.sessionTitle
        .refresh(session)
        .catch((error) => warn('handoff auto-rename failed for session', session.id, '-', describe(error)))
    } catch (error) {
      warn('handoff hook error:', describe(error))
    }
  })

  // ── 3) llm-pi-ai 路由思考接线自补齐 ─────────────────────────────
  const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

  function method(value, name) {
    if (typeof value !== 'object' && typeof value !== 'function' || value === null) return undefined
    const candidate = Reflect.get(value, name)
    return typeof candidate === 'function' ? candidate : undefined
  }

  /** 设置服务模型探测：'namespace'（0.1.6 前，有 register/installSection）
   * | 'entry-config'（0.1.7+，含 0.2.0，有 describe）。undefined = 两种都不是。 */
  const settingsModelOf = (settings) => {
    if (settings === undefined || settings === null) return undefined
    if (method(settings, 'register') !== undefined || method(settings, 'installSection') !== undefined) return 'namespace'
    return method(settings, 'describe') === undefined ? undefined : 'entry-config'
  }

  /** 设置变更事件名：entry-config 只发 settings/document-updated；
   * namespace 模型发 settings/updated。 */
  const settingsChangeEvents = (model) =>
    model === 'entry-config' ? ['settings/document-updated'] : ['settings/updated']

  function descriptorOf(settings, namespace) {
    const describe = method(settings, 'describe')
    if (describe === undefined) return undefined
    try {
      const descriptors = describe.call(settings)
      if (!Array.isArray(descriptors)) return undefined
      const row = descriptors.find((candidate) => isPlainObject(candidate) && String(candidate.ns) === namespace)
      return isPlainObject(row) ? row : undefined
    } catch {
      return undefined
    }
  }

  /** 读解析后的 section：0.1.x 有 get() 走 get()；0.1.7+/0.2.0 无 get，
   * 从 describe() 的 value 投影（与配置 UI 读到的同一解析形状）。永不抛错。 */
  const readSection = (settings, namespace) => {
    const get = method(settings, 'get')
    if (get !== undefined) {
      try {
        const value = get.call(settings, namespace)
        if (value !== undefined) return value
      } catch {
        // get 不可用/抛错 → 落到 describe
      }
    }
    const row = descriptorOf(settings, namespace)
    return row === undefined ? undefined : row.value
  }

  /** 读用户自己的层（只含用户显式写下的键）：写入载荷只能引用这层，
   * 否则会把解析时补上的 schema 默认值钉进用户文档。 */
  const readUserLayer = (settings, namespace) => {
    const row = descriptorOf(settings, namespace)
    if (row === undefined) return undefined
    return isPlainObject(row.user) ? row.user : undefined
  }

  /** 对单个模型条目做补齐判定（按解析值）并产出写入值（按用户层引用）。
   * 无需改动时返回原引用（供调用方按引用比较判定脏否）。 */
  const fillEntry = (resolved, userEntry, profile) => {
    const efforts = resolved.reasoningEfforts
    const hasEffortsDict = efforts !== false && isPlainObject(efforts)
    const isReasoning = hasEffortsDict ? Object.keys(efforts).length > 0 : false
    const profileCompat = isPlainObject(profile.compat) ? profile.compat : {}
    const modelCompat = isPlainObject(resolved.compat) ? resolved.compat : {}
    const effectiveFormat = modelCompat.thinkingFormat !== undefined
      ? modelCompat.thinkingFormat
      : profileCompat.thinkingFormat
    const resolvedKwargs = isPlainObject(modelCompat.chatTemplateKwargs) ? modelCompat.chatTemplateKwargs : {}
    // (a) 已声明档位字典但缺 off → 补 off: null
    const needsOff = hasEffortsDict && !('off' in efforts)
    // (b) 推理模型且无思考 wire → 补 chat-template enable_thinking 参数
    const needsWire =
      isReasoning &&
      (effectiveFormat === undefined || effectiveFormat === 'chat-template') &&
      resolvedKwargs.enable_thinking === undefined
    if (!needsOff && !needsWire) return userEntry
    const next = { ...userEntry }
    if (needsOff) {
      const userEfforts = isPlainObject(userEntry.reasoningEfforts) ? userEntry.reasoningEfforts : {}
      next.reasoningEfforts = { ...userEfforts, off: null }
    }
    if (needsWire) {
      const userCompat = isPlainObject(userEntry.compat) ? userEntry.compat : {}
      const userKwargs = isPlainObject(userCompat.chatTemplateKwargs) ? userCompat.chatTemplateKwargs : {}
      next.compat = {
        ...userCompat,
        ...(effectiveFormat === undefined ? { thinkingFormat: 'chat-template' } : {}),
        chatTemplateKwargs: {
          ...userKwargs,
          enable_thinking: { $var: 'thinking.enabled', omitWhenOff: false },
        },
      }
    }
    return next
  }

  /** 幂等补齐：算出需写入的 mutate 路径 op（只引用用户层条目）。
   * 返回改动的模型条目数（0 = 无需写入）。 */
  const fillRouteThinking = async () => {
    const settings = ctx.settings
    if (settings === undefined || settings.writable !== true) return 0
    const section = readSection(settings, NS)
    if (!isPlainObject(section)) return 0
    const providers = section.providers
    if (!isPlainObject(providers)) return 0
    // 用户层可能整体缺席（条目未注册/服务无 describe）——此时一切解析
    // 条目都不可写，只计 unreachable；不提前返回，保住该计数。
    const user = readUserLayer(settings, NS)
    const userProviders =
      user !== undefined && isPlainObject(user.providers) ? user.providers : undefined
    const ops = []
    let changed = 0
    let unreachable = 0
    // 探针哨兵：fillEntry 需补齐时返回新对象，否则原样返回。
    const PROBE = {}
    for (const [route, profile] of Object.entries(providers)) {
      if (!isPlainObject(profile)) continue
      const userProfile = userProviders[route]
      const ownProfile = isPlainObject(userProfile) ? userProfile : undefined
      // models 是数组容器：整体写入（旧设置服务只按对象走路径，
      // 数字索引会把数组替换成对象）。用户层没带该路由的 models 时
      // 不写——物化解析条目会把下层该条目的字段从解析值里挤掉。
      const models = profile.models
      if (Array.isArray(models) && Array.isArray(ownProfile?.models)) {
        const filledModels = ownProfile.models.map((userEntry, index) =>
          isPlainObject(userEntry) && isPlainObject(models[index])
            ? fillEntry(models[index], userEntry, profile)
            : userEntry,
        )
        const dirty = filledModels.some((m, i) => m !== ownProfile.models[i])
        if (dirty) {
          ops.push({ op: 'set', path: ['providers', route, 'models'], value: filledModels })
          changed += filledModels.filter((m, i) => m !== ownProfile.models[i]).length
        }
        for (let i = ownProfile.models.length; i < models.length; i += 1) {
          if (isPlainObject(models[i]) && fillEntry(models[i], PROBE, profile) !== PROBE) unreachable += 1
        }
      } else if (Array.isArray(models)) {
        for (const resolved of models) {
          if (isPlainObject(resolved) && fillEntry(resolved, PROBE, profile) !== PROBE) unreachable += 1
        }
      }
      // modelOverrides 是字典容器：部分条目可深并到下层之上，
      // 用户层没有该 id 时写最小片段也安全。
      const overrides = profile.modelOverrides
      if (isPlainObject(overrides)) {
        const userOverrides = isPlainObject(ownProfile?.modelOverrides) ? ownProfile.modelOverrides : {}
        for (const [id, resolvedEntry] of Object.entries(overrides)) {
          if (!isPlainObject(resolvedEntry)) continue
          const userEntry = isPlainObject(userOverrides[id]) ? userOverrides[id] : {}
          const filled = fillEntry(resolvedEntry, userEntry, profile)
          if (filled !== userEntry) {
            ops.push({ op: 'set', path: ['providers', route, 'modelOverrides', id], value: filled })
            changed += 1
          }
        }
      }
    }
    if (changed === 0 && unreachable > 0) {
      warn('left', unreachable, 'model entry(ies) unfilled: declared by a lower settings layer, which an array path write cannot address without pinning that layer\'s resolved fields')
    }
    if (changed === 0) return 0
    const mutate = method(settings, 'mutate')
    if (mutate === undefined) {
      warn('settings service cannot address paths; left', changed, 'model entry(ies) unfilled')
      return 0
    }
    await mutate.call(settings, NS, ops)
    log('filled thinking wiring for', changed, 'model entry(ies)')
    return changed
  }

  // 写入在 0.1.7 上由设置变更事件从写事务内部触发时，监听器回写会撞
  // 「HMR 事务不可嵌套」——用独立 AsyncResource 给写提供宿主接受的外层
  // 上下文（与 @hytime/dsh-thinking-effort 0.3.8 同法）。
  const fillScope = new AsyncResource('session-autotitle:settings-fill')
  const runFill = () => fillScope.runInAsyncScope(() => fillRouteThinking())

  // 挂载时补齐（带重试：llm-pi-ai 条目可能稍晚注册）。
  let attempts = 0
  const tryOnce = async () => {
    try {
      if ((await runFill()) > 0) return
    } catch (error) {
      warn('fill error:', describe(error))
    }
    attempts += 1
    if (attempts < 6) ctx.timeout(() => { void tryOnce() }, 2000)
  }
  ctx.timeout(() => { void tryOnce() }, 500)

  // 设置变更时（用户在 Models 页加模型/改档位）重新收敛。
  const model = settingsModelOf(ctx.settings)
  if (model !== undefined) {
    for (const event of settingsChangeEvents(model)) {
      ctx.on(event, (ns) => {
        if (ns !== NS) return
        void runFill().catch((error) => warn('watch fill error:', describe(error)))
      })
    }
  }

  log('applied: /autotitle command, /handoff hook, thinking-wiring fill')
}
