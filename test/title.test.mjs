/**
 * title.mjs（全消息标题提供方）单元测试。
 * 运行（在 profile 目录，保证 @deepseek-ai/* 可解析）：
 *   node --test 'C:\Users\desire_for_beauty\.dsh\profiles\desktop\node_modules\@hytime\dsh-session-autotitle\test\title.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

const mod = await import('@lyxx/dsh-session-autotitle/title')

const CONFIG = {
  targetWords: 8,
  targetCjkCharacters: 26,
  maxInputBytes: 16384,
  maxOutputTokens: 256,
  timeoutMs: 60000,
}

function makeCtx({ supportOff = true, streamText = 'DSH 会话自动重命名', finishReason = { kind: 'stop' }, titleLanguage, describe = true } = {}) {
  const calls = { resolve: [], stream: [], appends: [], registered: null }
  const ctx = {
    effects: [],
    effect(fn, label) {
      const disposer = fn()
      this.effects.push({ label, dispose: () => disposer?.() })
    },
    get(serviceName) {
      if (serviceName === 'settings') return describe ? ctx.settings : undefined
      return undefined
    },
    settings: {
      describe() {
        if (!describe) throw new Error('settings unavailable')
        const user = {}
        if (titleLanguage !== undefined) user.titleLanguage = titleLanguage
        return [{ ns: 'llm-pi-ai', value: {}, user, revision: 1 }]
      },
    },
    sessionTitle: {
      register(provider) {
        calls.registered = provider
        return () => {
          calls.registered = null
        }
      },
    },
    llm: {
      async resolveCallConfig(opts) {
        calls.resolve.push(opts)
        if (!supportOff) {
          const error = new Error('route does not support effort "off"')
          error.code = 'UNSUPPORTED_REASONING_EFFORT'
          throw error
        }
        return { provider: opts.provider, model: opts.model }
      },
      async *stream(opts) {
        calls.stream.push(opts)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: streamText }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: streamText } }
        yield { type: 'finish', reason: finishReason }
      },
    },
  }
  return { ctx, calls }
}

function makeRequest({ messages, route = { provider: 'qwen', model: 'qwen3.5-38b' }, signal = new AbortController().signal }) {
  return {
    session: {
      id: 'session-1',
      appends: [],
      append(type, data) {
        // 与 session 服务同语义：载荷必须纯 JSON 可序列化
        // （undefined 值键会被服务拒绝 —— 真实故障回归点）。
        const serialized = JSON.stringify(data, (key, value) => {
          if (value === undefined) throw new Error(`session event "${type}" carries non-JSON-serializable data (undefined at "${key}")`)
          return value
        })
        this.appends.push({ type, data: JSON.parse(serialized) })
      },
    },
    messages,
    route,
    signal,
  }
}

test('apply 注册 provider（first-prompt 时序 + 效果清理）', () => {
  const { ctx, calls } = makeCtx()
  mod.apply(ctx, { ...CONFIG })
  assert.ok(calls.registered, 'provider 已注册')
  assert.equal(calls.registered.automatic, 'first-prompt')
  assert.equal(typeof calls.registered.generate, 'function')
  assert.ok(calls.registered.id.length > 0)
  assert.equal(ctx.effects.length, 1)
  ctx.effects[0].dispose()
  assert.equal(calls.registered, null, 'disposer 移除注册')
})

test('配置校验：未知键 / 缺省 provider 对 / 非正整数', () => {
  const { ctx } = makeCtx()
  assert.throws(() => mod.apply(ctx, { ...CONFIG, bogus: 1 }), /unknown config key "bogus"/)
  assert.throws(() => mod.apply(ctx, { ...CONFIG, provider: 'qwen' }), /provider and model must be supplied together/)
  assert.throws(() => mod.apply(ctx, { ...CONFIG, provider: 'qwen', model: '' }), /non-empty strings/)
  assert.throws(() => mod.apply(ctx, { ...CONFIG, maxInputBytes: 0 }), /maxInputBytes must be a positive integer/)
  assert.throws(() => mod.apply(ctx, null), /configuration is required/)
})

test('generate：路由支持 off → 请求 reasoningEffort off，返回归一化标题与消息归属', async () => {
  const { ctx, calls } = makeCtx()
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({
    messages: [
      { seq: 1, text: '第一条：实现自动命名' },
      { seq: 3, text: '第二条：加菜单入口' },
    ],
  })
  const result = await calls.registered.generate(request)
  assert.equal(result.title, 'DSH 会话自动重命名')
  assert.deepEqual(result.messageSeqs, [1, 3])
  assert.deepEqual(result.model, { provider: 'qwen', model: 'qwen3.5-38b' })
  assert.deepEqual(calls.resolve[0], { provider: 'qwen', model: 'qwen3.5-38b', reasoningEffort: 'off' })
  const opts = calls.stream[0]
  assert.equal(opts.reasoningEffort, 'off')
  assert.equal(opts.purpose, 'session-title')
  assert.equal(opts.maxTokens, 256)
  assert.equal(opts.sessionId, 'session-1')
  assert.equal(opts.messages.length, 1)
  assert.equal(opts.messages[0].source.kind, 'plugin')
  const framed = opts.messages[0].content[0].text
  assert.ok(framed.includes('"seq":1') && framed.includes('"seq":3'), '两条消息都被框定')
  assert.equal(request.session.appends.length, 1)
  assert.equal(request.session.appends[0].type, 'session/title-llm-request')
  assert.deepEqual(request.session.appends[0].data.messageSeqs, [1, 3])
})

test('generate：路由不支持 off → 不带档位（其余适配器安全）', async () => {
  const { ctx, calls } = makeCtx({ supportOff: false })
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
  await calls.registered.generate(request)
  const opts = calls.stream[0]
  assert.ok(!('reasoningEffort' in opts), 'off 不受支持时不得携带档位')
})

test('generate：无配置路由且无请求路由 → 明确报错', async () => {
  const { ctx, calls } = makeCtx()
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
  delete request.route // 真实 service：无路由时该键缺省（非 undefined）
  await assert.rejects(() => calls.registered.generate(request), /no logged request route/)
})

test('generate：空消息 → 报错', async () => {
  const { ctx, calls } = makeCtx()
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({ messages: [] })
  await assert.rejects(() => calls.registered.generate(request), /at least one source message/)
})

test('generate：max-tokens 终局 → 失败', async () => {
  const { ctx, calls } = makeCtx({ finishReason: { kind: 'max-tokens' } })
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
  await assert.rejects(() => calls.registered.generate(request), /maxOutputTokens/)
})

test('generate：上游信号已中止 → 立即失败', async () => {
  const { ctx, calls } = makeCtx()
  mod.apply(ctx, { ...CONFIG })
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }], signal: controller.signal })
  await assert.rejects(() => calls.registered.generate(request))
  assert.equal(calls.stream.length, 0, '未发起 LLM 调用')
})

test('消息选择：预算内全部消息', async () => {
  const { ctx, calls } = makeCtx()
  mod.apply(ctx, { ...CONFIG })
  const messages = [1, 2, 3].map((seq) => ({ seq, text: '短消息' }))
  const request = makeRequest({ messages })
  const result = await calls.registered.generate(request)
  assert.deepEqual(result.messageSeqs, [1, 2, 3])
})

test('标题语言：未设置 / auto / 空白 → 跟随消息语言（行为同基线）', async () => {
  for (const value of [undefined, 'auto', '  AUTO  ', '']) {
    const { ctx, calls } = makeCtx({ titleLanguage: value })
    mod.apply(ctx, { ...CONFIG })
    const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
    await calls.registered.generate(request)
    const opts = calls.stream[0]
    assert.ok(opts.system.includes('Use the language of the messages.'), `value=${JSON.stringify(value)} 应为跟随消息语言`)
    assert.ok(!('language' in request.session.appends[0].data), '未设置时不得携带 language 键（undefined 不可 JSON 序列化）')
  }
})

test('标题语言：设置值 → 系统指令写死该语言并记入请求事件', async () => {
  const { ctx, calls } = makeCtx({ titleLanguage: ' English ' })
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({ messages: [{ seq: 1, text: '实现一个功能' }] })
  await calls.registered.generate(request)
  const opts = calls.stream[0]
  assert.ok(opts.system.includes('Write the title in English.'), '系统指令要求 English')
  assert.ok(!opts.system.includes('Use the language of the messages.'))
  assert.equal(request.session.appends[0].data.language, 'English')
})

test('标题语言：describe 不可用 / 非字符串 → 回退跟随，不抛错', async () => {
  const { ctx, calls } = makeCtx({ describe: false })
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
  await calls.registered.generate(request)
  assert.ok(calls.stream[0].system.includes('Use the language of the messages.'))
})

test('消息选择：超预算 → 首条锚点 + 最近窗口', async () => {
  const { ctx, calls } = makeCtx()
  // 每条 300 字节，5 条 ≈ 1500+ 开销 > 1200；首条 + 最近 2 条 ≈ 1000+ 开销 ≤ 1200
  const messages = [1, 2, 3, 4, 5].map((seq) => ({ seq, text: 'x'.repeat(300) }))
  mod.apply(ctx, { ...CONFIG, maxInputBytes: 1200 })
  const request = makeRequest({ messages })
  const result = await calls.registered.generate(request)
  assert.deepEqual(result.messageSeqs, [1, 4, 5], '保留首条与最近两条，丢弃中间')
  const framed = calls.stream[0].messages[0].content[0].text
  assert.ok(Buffer.byteLength(framed, 'utf8') <= 1200)
})
