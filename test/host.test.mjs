/**
 * host.mjs（/autotitle 命令 + /handoff 钩子 + 思考接线自补齐）单元测试。
 * 运行（在 profile 目录）：
 *   node --test 'C:\Users\desire_for_beauty\.dsh\profiles\desktop\node_modules\@hytime\dsh-session-autotitle\test\host.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const mod = await import('@lyxx/dsh-session-autotitle')

const tick = () => new Promise((resolve) => setImmediate(resolve))

const clone = (value) => (value === undefined ? undefined : structuredClone(value))

/**
 * llm-pi-ai 段的双层夹具：
 * - user：用户自己层（写入载荷只允许引用这层；不含 schema 默认值）；
 * - value：解析后的 section（schema 默认值已物化 —— 只用于判定"缺什么"）。
 */
function makeSection() {
  const user = {
    providers: {
      qwen: {
        api: 'openai-completions',
        baseURL: 'http://localhost:16324/v1',
        apiKeyEnv: 'QWEN_API_KEY',
        models: [
          {
            id: 'qwen3.5-38b',
            name: 'qwen3.8-27b',
            reasoningEfforts: { low: 'low', medium: 'medium', xhigh: 'xhigh' },
            input: ['text', 'image'],
            compat: { chatTemplateKwargs: {} },
          },
          {
            id: 'qwen3.8-27b-fp8',
            reasoningEfforts: false,
          },
        ],
        modelOverrides: {},
      },
    },
  }
  const value = {
    providers: {
      qwen: {
        ...user.providers.qwen,
        models: user.providers.qwen.models.map((m) => ({ contextWindow: 262144, maxTokens: 32768, ...m })),
      },
    },
  }
  return { user, value }
}

/**
 * 设置服务双模型夹具：
 * - 'entry-config'（0.1.7+/0.2.0，默认）：无 get()，describe() 行带
 *   value/user/revision，写入走 mutate(ns, ops)；
 * - 'namespace'（0.1.6 前）：额外有 get()/register()。
 * mutate 会真正把 op 应用到 user 与 value 两层（模拟文档合并），
 * 供幂等断言使用。
 */
function makeSettingsMock(state, { model = 'entry-config' } = {}) {
  const applyOps = (root, ops) => {
    for (const op of ops) {
      let node = root
      for (let i = 0; i < op.path.length - 1; i += 1) node = node[op.path[i]]
      node[op.path[op.path.length - 1]] = clone(op.value)
    }
  }
  const settings = {
    writable: true,
    describe() {
      return [
        { ns: 'llm-pi-ai', value: clone(state.resolved), user: clone(state.user), revision: state.revision },
      ]
    },
    async mutate(ns, ops) {
      if (ns !== 'llm-pi-ai') throw new Error(`unknown namespace "${ns}"`)
      state.mutates.push({ ns, ops: clone(ops) })
      applyOps(state.user, ops)
      applyOps(state.resolved, ops)
      state.revision += 1
    },
  }
  if (model === 'namespace') {
    settings.register = () => {}
    settings.get = (ns) => (ns === 'llm-pi-ai' ? clone(state.resolved) : undefined)
  }
  return settings
}

function makeCtx({ section = makeSection(), pinned = false, settingsModel = 'entry-config' } = {}) {
  const state = {
    commands: [],
    effects: 0,
    handlers: {},
    timeouts: [],
    refreshes: [],
    mutates: [],
    resolved: clone(section.value),
    user: clone(section.user),
    revision: 1,
  }
  const ctx = {
    effect(fn, label) {
      state.effects += 1
      fn()
    },
    timeout(fn, ms) {
      state.timeouts.push({ fn, ms })
    },
    on(name, handler) {
      state.handlers[name] = handler
    },
    sessions: {},
    sessionTitle: {
      get() {
        return pinned ? { title: '钉住的标题', source: { kind: 'user' } } : { title: '旧标题', source: { kind: 'provider', provider: 'x' } }
      },
      async refresh(session, signal) {
        state.refreshes.push({ id: session.id, signal })
        return { title: '新标题', source: { kind: 'provider' } }
      },
    },
    commands: {
      register(def) {
        state.commands.push(def)
        return () => {}
      },
    },
    timer: {},
  }
  ctx.settings = makeSettingsMock(state, { model: settingsModel })
  return { ctx, state }
}

function makeInvocation(sessionId = 's1') {
  return {
    commandId: 'c1',
    agent: { session: { id: sessionId } },
    rawInput: '',
    attachments: [],
    signal: new AbortController().signal,
  }
}

function makeSession(id = 's1', { parentSession } = {}) {
  return { id, header: parentSession === undefined ? { parentSession: undefined } : { parentSession } }
}

function fireSessionEvent(state, session, event) {
  state.handlers['session/event'](session, event)
}

function userMessageEvent(content) {
  return {
    type: 'user/message',
    data: {
      source: { kind: 'user' },
      content,
    },
  }
}

test('/autotitle 命令注册 + 成功路径', async () => {
  const { ctx, state } = makeCtx()
  mod.apply(ctx)
  assert.equal(state.commands.length, 1)
  assert.equal(state.commands[0].name, 'autotitle')
  const result = await state.commands[0].handler(makeInvocation())
  assert.equal(result.kind, 'success')
  assert.match(result.text, /新标题/)
  assert.equal(state.refreshes.length, 1)
})

test('/autotitle 命令：无用户消息 → 错误文案', async () => {
  const { ctx, state } = makeCtx()
  mod.apply(ctx)
  ctx.sessionTitle.refresh = async () => undefined
  const result = await state.commands[0].handler(makeInvocation())
  assert.equal(result.kind, 'error')
  assert.match(result.text, /没有可用的用户消息/)
  assert.equal(state.refreshes.length, 0)
})

test('/autotitle 命令：refresh 失败 → 错误文案带原因', async () => {
  const { ctx, state } = makeCtx()
  mod.apply(ctx)
  ctx.sessionTitle.refresh = async () => {
    throw new Error('LLM 连接超时')
  }
  const result = await state.commands[0].handler(makeInvocation())
  assert.equal(result.kind, 'error')
  assert.match(result.text, /自动重命名失败/)
  assert.match(result.text, /LLM 连接超时/)
})

test('/handoff 手势 → 自动重命名（顶层、未钉住）', async () => {
  const { ctx, state } = makeCtx()
  mod.apply(ctx)
  fireSessionEvent(state, makeSession(), userMessageEvent([{ type: 'text', text: '/handoff 请生成交接文档' }]))
  await tick()
  assert.equal(state.refreshes.length, 1, '触发了一次 refresh')
})

test('/handoff 手势：refresh 失败 → 静默（仅宿主日志，不抛未处理拒绝）', async () => {
  const { ctx, state } = makeCtx()
  mod.apply(ctx)
  ctx.sessionTitle.refresh = async () => {
    throw new Error('LLM 连接超时')
  }
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => {
    warnings.push(args.join(' '))
  }
  try {
    fireSessionEvent(state, makeSession(), userMessageEvent([{ type: 'text', text: '/handoff' }]))
    await tick()
    await tick()
  } finally {
    console.warn = originalWarn
  }
  assert.equal(state.refreshes.length, 0, '失败的 refresh 不留成功记录（makeCtx 的 refresh 被覆写）')
  assert.ok(warnings.some((w) => w.includes('handoff auto-rename failed')), '宿主日志有 warn')
})

test('/handoff 手势：多文本块中第二块命中 → 触发；块边界不拼接', async () => {
  const { ctx, state } = makeCtx()
  mod.apply(ctx)
  // 第二块独立命中
  fireSessionEvent(state, makeSession(), userMessageEvent([
    { type: 'text', text: '先说点别的' },
    { type: 'text', text: '然后 /handoff' },
  ]))
  await tick()
  assert.equal(state.refreshes.length, 1)
  // 跨块伪手势：块1 以 '/' 结尾 + 块2 以 'handoff' 开头（与技能加载器语义一致：不触发）
  fireSessionEvent(state, makeSession(), userMessageEvent([
    { type: 'text', text: '路径 C:/' },
    { type: 'text', text: 'handoff 这个词' },
  ]))
  await tick()
  assert.equal(state.refreshes.length, 1, '跨块不拼接，未新增触发')
  // 非 handoff 技能名不触发
  fireSessionEvent(state, makeSession(), userMessageEvent([{ type: 'text', text: '/grill-with-docs 开始' }]))
  await tick()
  assert.equal(state.refreshes.length, 1)
})

test('/handoff 手势：用户钉住的标题跳过', async () => {
  const { ctx, state } = makeCtx({ pinned: true })
  mod.apply(ctx)
  fireSessionEvent(state, makeSession(), userMessageEvent([{ type: 'text', text: '/handoff' }]))
  await tick()
  assert.equal(state.refreshes.length, 0, '钉住标题不被 handoff 覆盖')
})

test('/handoff 手势：无手势 / 非用户来源 / 子会话 均不触发', async () => {
  const { ctx, state } = makeCtx()
  mod.apply(ctx)
  fireSessionEvent(state, makeSession(), userMessageEvent([{ type: 'text', text: '普通消息 /hand 没有off' }]))
  fireSessionEvent(state, makeSession(), {
    type: 'user/message',
    data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '/handoff' }] },
  })
  fireSessionEvent(state, makeSession(), { type: 'request/header', data: {} })
  fireSessionEvent(state, makeSession('s2', { parentSession: 's1' }), userMessageEvent([{ type: 'text', text: '/handoff' }]))
  await tick()
  assert.equal(state.refreshes.length, 0)
})

test('思考接线自补齐（0.2.0 entry-config：无 get，describe+mutate）：补 off + enable_thinking，一次收敛且幂等', async () => {
  const { ctx, state } = makeCtx()
  assert.equal(ctx.settings.get, undefined, '夹具即 0.2.0 形状：无 get()')
  mod.apply(ctx)
  assert.equal(typeof state.handlers['settings/document-updated'], 'function', '监听 0.2.0 变更事件名')
  assert.equal(state.handlers['settings/updated'], undefined, '不再监听旧事件名')
  // 触发挂载重试链的第一次（500ms 那个）
  state.timeouts.sort((a, b) => a.ms - b.ms)
  state.timeouts[0].fn()
  await tick()
  assert.equal(state.mutates.length, 1, '只写一次')
  assert.equal(state.mutates[0].ns, 'llm-pi-ai')
  const modelOp = state.mutates[0].ops.find((op) => op.path.join('.') === 'providers.qwen.models')
  assert.ok(modelOp, '写 providers.qwen.models 整条路径（数组容器整体写）')
  const m1 = modelOp.value.find((m) => m.id === 'qwen3.5-38b')
  assert.equal(m1.reasoningEfforts.off, null, '补 off 档位')
  assert.equal(m1.reasoningEfforts.medium, 'medium', '保留既有档位')
  assert.equal(m1.name, 'qwen3.8-27b', '引用用户层条目（用户键保留）')
  assert.equal(m1.contextWindow, undefined, '不钉 schema 默认值')
  assert.equal(m1.compat.thinkingFormat, 'chat-template')
  assert.deepEqual(m1.compat.chatTemplateKwargs, { enable_thinking: { $var: 'thinking.enabled', omitWhenOff: false } }, '既有空 kwargs 上补 enable_thinking')
  const m2 = modelOp.value.find((m) => m.id === 'qwen3.8-27b-fp8')
  assert.equal(m2.reasoningEfforts, false, 'reasoningEfforts:false 的模型不动')
  assert.equal(m2.compat, undefined, '无 compat 的模型不加 compat')
  // 幂等：再触发一次不产生写入
  state.handlers['settings/document-updated']('llm-pi-ai')
  await tick()
  assert.equal(state.mutates.length, 1, '收敛后不再写入')
})

test('思考接线自补齐：旧 namespace 模型（有 get）同样走 mutate 写入 + 旧事件名', async () => {
  const { ctx, state } = makeCtx({ settingsModel: 'namespace' })
  assert.equal(typeof ctx.settings.get, 'function')
  mod.apply(ctx)
  assert.equal(typeof state.handlers['settings/updated'], 'function', '监听 namespace 模型事件名')
  state.timeouts.sort((a, b) => a.ms - b.ms)
  state.timeouts[0].fn()
  await tick()
  assert.equal(state.mutates.length, 1)
  const m1 = state.mutates[0].ops[0].value.find((m) => m.id === 'qwen3.5-38b')
  assert.deepEqual(m1.compat.chatTemplateKwargs.enable_thinking, { $var: 'thinking.enabled', omitWhenOff: false })
  assert.equal(m1.reasoningEfforts.off, null)
})

test('思考接线自补齐：已有其他 thinkingFormat 的推理模型不动（off 仍补）', async () => {
  const section = makeSection()
  section.user.providers.qwen.models[0].compat = { thinkingFormat: 'qwen', chatTemplateKwargs: {} }
  section.value.providers.qwen.models[0].compat = { thinkingFormat: 'qwen', chatTemplateKwargs: {} }
  const { ctx, state } = makeCtx({ section })
  mod.apply(ctx)
  state.timeouts.sort((a, b) => a.ms - b.ms)
  state.timeouts[0].fn()
  await tick()
  assert.equal(state.mutates.length, 1, 'off 档位仍需写入')
  const m1 = state.mutates[0].ops[0].value.find((m) => m.id === 'qwen3.5-38b')
  assert.equal(m1.compat.thinkingFormat, 'qwen', '保留既有 format')
  assert.equal(m1.compat.chatTemplateKwargs.enable_thinking, undefined, '不叠加模板参数')
  assert.equal(m1.reasoningEfforts.off, null, 'off 档位仍补')
})

test('思考接线自补齐：用户层未携带的路由 → 不写（避免钉默认值），warn 计数', async () => {
  const section = makeSection()
  section.user = { providers: {} } // 路由只存在于下层
  const { ctx, state } = makeCtx({ section })
  mod.apply(ctx)
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => { warnings.push(args.join(' ')) }
  try {
    state.timeouts.sort((a, b) => a.ms - b.ms)
    state.timeouts[0].fn()
    await tick()
  } finally {
    console.warn = originalWarn
  }
  assert.equal(state.mutates.length, 0, '不写用户层没有的数组容器')
  assert.ok(warnings.some((w) => w.includes('left 1 model entry')), 'warn 报告不可达条目')
})

test('思考接线自补齐：settings 只读 → 静默跳过', async () => {
  const { ctx, state } = makeCtx()
  ctx.settings.writable = false
  mod.apply(ctx)
  state.timeouts.sort((a, b) => a.ms - b.ms)
  state.timeouts[0].fn()
  await tick()
  assert.equal(state.mutates.length, 0)
})
