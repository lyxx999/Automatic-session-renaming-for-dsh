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
 */
export const name = '@lyxx/dsh-session-autotitle'
export const inject = ['sessions', 'sessionTitle', 'commands', 'settings', 'timer']

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
  const readSection = () => {
    let section
    try {
      section = ctx.settings.get(NS)
    } catch {
      section = undefined
    }
    return section
  }

  const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

  /** 幂等补齐。返回改动的模型条目数（0 = 无需写入）。 */
  const fillRouteThinking = async () => {
    const settings = ctx.settings
    if (settings === undefined || settings.writable !== true) return 0
    const section = readSection()
    if (!isPlainObject(section)) return 0
    const providers = section.providers
    if (!isPlainObject(providers)) return 0
    const next = {}
    let changed = 0
    const processEntry = (entry, profile) => {
      if (!isPlainObject(entry)) return entry
      let nextEntry = entry
      let dirty = false
      const efforts = nextEntry.reasoningEfforts
      const hasEffortsDict = efforts !== false && isPlainObject(efforts)
      // (a) 已声明档位字典但缺 off → 补 off: null
      if (hasEffortsDict && !('off' in efforts)) {
        nextEntry = { ...nextEntry, reasoningEfforts: { ...efforts, off: null } }
        dirty = true
        changed += 1
      }
      // (b) 推理模型且无思考 wire → 补 chat-template enable_thinking 参数
      const profileCompat = isPlainObject(profile.compat) ? profile.compat : {}
      const modelCompat = isPlainObject(nextEntry.compat) ? nextEntry.compat : {}
      const effectiveFormat = modelCompat.thinkingFormat !== undefined
        ? modelCompat.thinkingFormat
        : profileCompat.thinkingFormat
      const isReasoning =
        hasEffortsDict ? Object.keys(efforts).length > 0 : false
      const kwargs = isPlainObject(modelCompat.chatTemplateKwargs) ? modelCompat.chatTemplateKwargs : {}
      if (
        isReasoning &&
        (effectiveFormat === undefined || effectiveFormat === 'chat-template') &&
        kwargs.enable_thinking === undefined
      ) {
        nextEntry = {
          ...nextEntry,
          compat: {
            ...modelCompat,
            ...(effectiveFormat === undefined ? { thinkingFormat: 'chat-template' } : {}),
            chatTemplateKwargs: {
              ...kwargs,
              enable_thinking: { $var: 'thinking.enabled', omitWhenOff: false },
            },
          },
        }
        dirty = true
        changed += 1
      }
      return dirty ? nextEntry : entry
    }
    for (const [route, profile] of Object.entries(providers)) {
      if (!isPlainObject(profile)) {
        next[route] = profile
        continue
      }
      const nextProfile = { ...profile }
      if (Array.isArray(profile.models)) {
        nextProfile.models = profile.models.map((entry) => processEntry(entry, profile))
      }
      if (isPlainObject(profile.modelOverrides)) {
        const overrides = {}
        for (const [id, entry] of Object.entries(profile.modelOverrides)) {
          overrides[id] = processEntry(entry, profile)
        }
        nextProfile.modelOverrides = overrides
      }
      next[route] = nextProfile
    }
    if (changed === 0) return 0
    await settings.update(NS, { providers: next })
    log('filled thinking wiring for', changed, 'model entry(ies)')
    return changed
  }

  // 挂载时补齐（带重试：llm-pi-ai 命名空间可能稍晚注册）。
  let attempts = 0
  const tryOnce = async () => {
    try {
      if ((await fillRouteThinking()) > 0) return
    } catch (error) {
      warn('fill error:', describe(error))
    }
    attempts += 1
    if (attempts < 6) ctx.timeout(() => { void tryOnce() }, 2000)
  }
  ctx.timeout(() => { void tryOnce() }, 500)

  // 设置变更时（用户在 Models 页加模型/改档位）重新收敛。
  ctx.on('settings/updated', (ns) => {
    if (ns !== NS) return
    void fillRouteThinking().catch((error) => warn('watch fill error:', describe(error)))
  })

  log('applied: /autotitle command, /handoff hook, thinking-wiring fill')
}
