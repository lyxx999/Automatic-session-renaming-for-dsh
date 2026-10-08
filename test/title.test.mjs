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

function makeCtx({ supportOff = true, streamText = 'DSH 会话自动重命名', finishReason = { kind: 'stop' }, titleLanguage, titleMaxBytes, legacyTitleLanguage, legacyTitleMaxBytes, describe = true } = {}) {
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
        // 自有条目（0.1.7+ 主存储）
        const own = {}
        if (titleLanguage !== undefined) own.titleLanguage = titleLanguage
        if (titleMaxBytes !== undefined) own.titleMaxBytes = titleMaxBytes
        const rows = [{ ns: 'session-autotitle', value: {}, user: own, revision: 1 }]
        // 旧 llm-pi-ai 键（≤0.1.6 存储位置，回退）
        const legacy = {}
        if (legacyTitleLanguage !== undefined) legacy.titleLanguage = legacyTitleLanguage
        if (legacyTitleMaxBytes !== undefined) legacy.titleMaxBytes = legacyTitleMaxBytes
        rows.push({ ns: 'llm-pi-ai', value: {}, user: legacy, revision: 2 })
        return rows
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
  assert.equal(opts.messages[0].source.kind, 'plugin:dsh-session-autotitle')
  const framed = opts.messages[0].content[0].text
  assert.ok(framed.includes('"seq":1') && framed.includes('"seq":3'), '两条消息都被框定')
  assert.equal(request.session.appends.length, 1)
  assert.equal(request.session.appends[0].type, 'session/title-llm-request')
  assert.deepEqual(request.session.appends[0].data.messageSeqs, [1, 3])
})

test('generate：标题消息 source 是 v4 producer-owned kind（不用退役的 plugin 包装）', async () => {
  // 回归：DSH 0.2.0-rc.2+（会话格式 v4）的写入路径
  // （dsh-session-format-v3-to-v4 的 assertV4SourceRowAdmission）拒绝
  // 退役的裸 { kind: 'plugin', plugin: … } 包装——当时 0.2.3 因此导致
  // 新会话首条提示词整批落盘失败（agent turn failed + 回退标题 +
  // projection cache 持续告警）。未知第三方插件的 v4 规范写法是
  // 'plugin:<插件名>'（与 v3→v4 迁移的产出一致）。
  const { ctx, calls } = makeCtx()
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
  await calls.registered.generate(request)
  assert.equal(request.session.appends.length, 1)
  const source = request.session.appends[0].data.messages[0].source
  assert.equal(typeof source.kind, 'string')
  assert.ok(source.kind.length > 0, 'kind 必须非空')
  assert.notEqual(source.kind, 'plugin', '裸 plugin 包装已被 v4 写入路径拒收')
  assert.equal(source.kind, 'plugin:dsh-session-autotitle')
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

test('标题语言：自有条目为空 → 回退旧 llm-pi-ai 键（≤0.1.6 宿主）', async () => {
  const { ctx, calls } = makeCtx({ legacyTitleLanguage: 'Chinese' })
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
  await calls.registered.generate(request)
  assert.ok(calls.stream[0].system.includes('Write the title in Chinese.'), '旧键值生效')
})

test('标题语言/字节数：自有条目优先于旧键（双位置冲突时）', async () => {
  const { ctx, calls } = makeCtx({ titleLanguage: 'English', legacyTitleLanguage: 'Chinese', titleMaxBytes: 40, legacyTitleMaxBytes: 30 })
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
  await calls.registered.generate(request)
  assert.ok(calls.stream[0].system.includes('Write the title in English.'), '自有语言优先')
  assert.ok(calls.stream[0].system.includes('under 40 UTF-8 bytes'), '自有字节数优先')
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

test('标题字节数：未设置 → 默认 80（系统指令 + 按 80 截断）', async () => {
  // 30 个 CJK 字 = 90 字节 → 截断到 80 字节内（26 字 = 78 字节）
  const { ctx, calls } = makeCtx({ streamText: '字'.repeat(30) })
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
  const result = await calls.registered.generate(request)
  assert.ok(calls.stream[0].system.includes('under 80 UTF-8 bytes'), '系统指令要求 80 字节')
  assert.equal(result.title, '字'.repeat(26), '按 80 字节在字符边界截断')
})

test('标题字节数：设置 40（数值/字符串）→ 指令要求 40 并按 40 截断', async () => {
  for (const value of [40, ' 40 ']) {
    const { ctx, calls } = makeCtx({ streamText: '字'.repeat(30), titleMaxBytes: value })
    mod.apply(ctx, { ...CONFIG })
    const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
    const result = await calls.registered.generate(request)
    assert.ok(calls.stream[0].system.includes('under 40 UTF-8 bytes'), `value=${JSON.stringify(value)} 系统指令要求 40 字节`)
    // 40 字节 → 13 个 CJK 字（39 字节），第 14 字会越界
    assert.equal(result.title, '字'.repeat(13))
    assert.ok(Buffer.byteLength(result.title, 'utf8') <= 40)
  }
})

test('标题字节数：非法值（非整数/越界/非数值）→ 回退默认 80，不抛错', async () => {
  for (const value of ['40abc', 0, -5, 999, 40.5, null, true]) {
    const { ctx, calls } = makeCtx({ titleMaxBytes: value })
    mod.apply(ctx, { ...CONFIG })
    const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
    await calls.registered.generate(request)
    assert.ok(calls.stream[0].system.includes('under 80 UTF-8 bytes'), `value=${JSON.stringify(value)} 应回退 80`)
  }
})

test('标题字节数：describe 不可用 → 回退默认 80，不抛错', async () => {
  const { ctx, calls } = makeCtx({ describe: false })
  mod.apply(ctx, { ...CONFIG })
  const request = makeRequest({ messages: [{ seq: 1, text: 'hi' }] })
  await calls.registered.generate(request)
  assert.ok(calls.stream[0].system.includes('under 80 UTF-8 bytes'))
})
