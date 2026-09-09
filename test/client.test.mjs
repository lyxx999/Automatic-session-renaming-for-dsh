/**
 * client.js（会话头按钮 + 设置分区 bundle）结构测试：stub 浏览器环境执行
 * 真实 bundle，验证 ModuleLoader 注册、locale/插槽注册、渲染输出、
 * 点击 → /autotitle 链路、设置分区读写（describe/mutate ops）。
 * 运行（在 profile 目录）：
 *   node --test 'C:\Users\desire_for_beauty\.dsh\profiles\desktop\node_modules\@hytime\dsh-session-autotitle\test\client.test.mjs'
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const tick = () => new Promise((resolve) => setImmediate(resolve))

// ── 最小 React stub（createElement + useState + 一次性 useEffect） ──
function makeReactStub() {
  const states = []
  let hookIndex = 0
  let effectRan = false
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) }
    },
    useState(initial) {
      const i = hookIndex
      hookIndex += 1
      if (!(i in states)) states[i] = initial
      const set = (v) => {
        states[i] = typeof v === 'function' ? v(states[i]) : v
      }
      return [states[i], set]
    },
    useEffect(fn) {
      if (!effectRan) {
        effectRan = true
        fn()
      }
    },
  }
  const render = (Component, props) => {
    hookIndex = 0
    return Component(props)
  }
  return { React, render }
}

// ── 浏览器环境 stub ────────────────────────────────────────────────
const loadCalls = []
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loadCalls.push(spec)
    },
  },
  getComputedStyle: () => ({ backgroundColor: 'rgb(0, 0, 0)' }),
  matchMedia: (query) => ({ matches: true, media: query }),
}
const styleTags = []
globalThis.document = {
  body: {},
  createElement(tag) {
    const el = { tag, textContent: '', remove() { this.removed = true } }
    styleTags.push(el)
    return el
  },
  head: {
    appendChild(el) {
      el.appended = true
    },
  },
}

let lastReact = null
const requireStub = (name) => {
  if (name === 'react') {
    lastReact = makeReactStub()
    return lastReact.React
  }
  throw new Error(`unexpected require("${name}") in client bundle`)
}

// ── 执行真实 bundle ────────────────────────────────────────────────
await import('@lyxx/dsh-session-autotitle/client')

test('bundle 经 __ModuleLoader__ 注册一次，id 正确', () => {
  assert.equal(loadCalls.length, 1)
  assert.equal(loadCalls[0].id, '@lyxx/dsh-session-autotitle')
  assert.equal(typeof loadCalls[0].factory, 'function')
})

/**
 * DSH ≥0.1.2 设置 wire（ctx.remote.settings）：
 * describe() 无参 → 扁平 {ok, value}；mutate(ns, ops, expectedRevision) 位置参数。
 * 命名空间面必须在插件 inject 声明（"remote"、"remote.settings"）。
 */
function makeSettingsApi({ user = {}, revision = 7 } = {}) {
  const calls = { describe: 0, describeArgs: [], mutate: [] }
  const applyOps = (nextUser, ops) => {
    for (const op of ops) {
      if (op.op === 'set') nextUser[op.path[op.path.length - 1]] = op.value
      if (op.op === 'unset') delete nextUser[op.path[op.path.length - 1]]
    }
    return nextUser
  }
  const api = {
    async describe(...args) {
      calls.describe += 1
      calls.describeArgs.push(args)
      return {
        ok: true,
        value: {
          namespaces: user === null ? [] : [{ ns: 'llm-pi-ai', value: {}, user, revision }],
        },
      }
    },
    async mutate(ns, ops, expectedRevision) {
      calls.mutate.push({ ns, ops, expectedRevision })
      const nextUser = applyOps({ ...user }, ops)
      return { ok: true, value: { ns, value: {}, user: nextUser, revision: revision + 1 } }
    },
  }
  return { api, calls }
}

/** @param settingsApi - 设置 wire（挂在 ctx.get('remote').settings 上；null = wire 缺失） */
function makeClientCtx(settingsApi) {
  const state = { locale: null, injects: [], registers: [], effects: 0, commands: [] }
  const ctx = {
    locale: {
      register(ns, dict) {
        state.locale = { ns, dict }
      },
      bind() {
        return (key) => state.locale.dict.zh[key] ?? key
      },
    },
    slots: {
      inject(name, fn) {
        state.injects.push({ name, fn })
      },
      register(options, component) {
        state.registers.push({ options, component })
      },
    },
    effect(fn, label) {
      state.effects += 1
      fn()
    },
    sessions: {
      binding(id) {
        if (id === 'missing') return undefined
        return {
          session: {
            command(line) {
              state.commands.push(line)
              return Promise.resolve({ ok: true, value: { matched: true } })
            },
          },
        }
      },
    },
    get(name) {
      if (name === 'remote') return settingsApi ? { settings: settingsApi.api } : undefined
      return undefined
    },
  }
  return { ctx, state }
}

/**
 * @param stateOverrides - {user, revision, user:null 表示命名空间缺失}
 * @param wire - 'new'（默认，ctx.remote.settings）| 'none'（设置 wire 缺失）
 */
function applyBundle(stateOverrides, wire = 'new') {
  const settings = wire === 'none' ? null : makeSettingsApi(stateOverrides || {})
  const { ctx, state } = makeClientCtx(settings)
  const exports = loadCalls[0].factory(requireStub)
  exports.apply(ctx)
  for (const inject of state.injects) inject.fn()
  return { ctx, state, settings, exports }
}

test('apply：locale 词典（4 语言）+ 两个插槽注册', () => {
  const { state, exports } = applyBundle({})
  assert.equal(state.locale.ns, 'session-autotitle')
  // loader 门禁：访问 remote.settings 命名空间面必须在 inject 声明
  assert.deepEqual(exports.inject, ['sessions', 'slots', 'locale', 'remote', 'remote.settings'])
  for (const lang of ['zh', 'en', 'ja', 'ko']) {
    assert.ok(state.locale.dict[lang], `词典含 ${lang}`)
    assert.equal(state.locale.dict[lang]['autotitle.label'].length > 0, true)
    assert.equal(typeof state.locale.dict[lang]['settings.title'], 'string')
  }
  const injected = state.injects.map((i) => i.name)
  assert.deepEqual(injected, ['conversation.session.header.actions', 'settings.section'])
  const header = state.registers.find((r) => r.options.id === 'session-autotitle')
  assert.equal(header.options.order, 100)
  const settingsSection = state.registers.find((r) => r.options.id === 'session-autotitle-settings')
  assert.equal(settingsSection.options.order, 13)
  assert.equal(settingsSection.options.label(), '会话自动命名', 'label 经 locale.bind')
  assert.equal(state.effects, 2, 'locale + styles 两个 effect')
  assert.equal(styleTags.length, 1)
  assert.equal(styleTags[0].appended, true)
  assert.match(styleTags[0].textContent, /sa-autotitle/)
})

test('会话头按钮：渲染 + 点击 → /autotitle + 忙碌态 + 未知会话静默', async () => {
  const { state } = applyBundle({})
  const wrapper = state.registers.find((r) => r.options.id === 'session-autotitle').component
  const t = (key) => state.locale.dict.zh[key]
  const sessionProps = { sessionId: 's1', t, useSessions: () => null, useSession: () => null, useInput: () => null, inputActions: {} }

  const outer = lastReact.render(wrapper, sessionProps)
  const button = lastReact.render(outer.type, outer.props)
  assert.equal(button.type, 'button')
  assert.equal(button.props.className, 'sa-autotitle')
  assert.equal(button.props.disabled, false)
  assert.equal(button.props['aria-label'], '自动重命名会话（LLM 总结）')
  const label = button.children.find((child) => child && child.type === 'span')
  assert.ok(label, '按钮含 label span')
  assert.equal(label.children[0], '自动重命名')

  button.props.onClick()
  const busyButton = lastReact.render(outer.type, outer.props)
  assert.equal(busyButton.props.disabled, true, '忙碌期禁用')
  assert.equal(busyButton.children.find((c) => c && c.type === 'span').children[0], '正在总结…')
  await tick()
  const doneButton = lastReact.render(outer.type, outer.props)
  assert.equal(doneButton.props.disabled, false, '完成后复位')
  assert.deepEqual(state.commands, ['/autotitle'])

  const outer2 = lastReact.render(wrapper, { ...sessionProps, sessionId: 'missing' })
  const button2 = lastReact.render(outer2.type, outer2.props)
  await button2.props.onClick()
  await tick()
  assert.deepEqual(state.commands, ['/autotitle'], '未知会话不发送命令')
})

/** 设置分区 component 是 wrapper：两段渲染得到真实组件树。 */
const renderSection = (section, t) => {
  const outer = lastReact.render(section, { t })
  return lastReact.render(outer.type, outer.props)
}

const findNode = (el, pred) => {
  const walk = (node) => {
    if (node === null || node === undefined) return undefined
    if (pred(node)) return node
    for (const child of node.children ?? []) {
      const found = walk(child)
      if (found) return found
    }
    return undefined
  }
  return walk(el)
}

const nodeText = (node) => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  return (node.children ?? []).map(nodeText).join('')
}

test('设置分区：加载已存语言 → 下拉映射为对应选项', async () => {
  const { state, settings } = applyBundle({ user: { titleLanguage: 'English' }, revision: 7 })
  const section = state.registers.find((r) => r.options.id === 'session-autotitle-settings').component
  const t = (k, params) => String(state.locale.dict.zh[k] ?? k).replace(/\{(\w+)\}/g, (m, n) => (params && n in params ? String(params[n]) : m))
  renderSection(section, t) // 挂载 → useEffect 读取
  assert.equal(settings.calls.describe, 1, '挂载时读取一次')
  await tick() // describe 的 then 落地
  const loaded = renderSection(section, t)
  const select = findNode(loaded, (n) => n.type === 'select')
  assert.equal(select.props.value, 'english', '已存 English → english 选项')
  assert.ok(nodeText(loaded).includes('当前：English'))
})

test('设置分区：选择中文并应用 → mutate set titleLanguage=Chinese；再应用 auto → unset', async () => {
  const { state, settings } = applyBundle({ user: {}, revision: 7 })
  const section = state.registers.find((r) => r.options.id === 'session-autotitle-settings').component
  const t = (k) => state.locale.dict.zh[k]
  renderSection(section, t)
  await tick() // describe 落地

  let element = renderSection(section, t)
  findNode(element, (n) => n.type === 'select').props.onChange({ target: { value: 'chinese' } })
  element = renderSection(section, t)
  findNode(element, (n) => n.type === 'button' && n.props.onClick).props.onClick()
  await tick()
  assert.equal(settings.calls.mutate.length, 1)
  assert.deepEqual(settings.calls.mutate[0], {
    ns: 'llm-pi-ai',
    ops: [
      { op: 'set', path: ['titleLanguage'], value: 'Chinese' },
      { op: 'unset', path: ['titleMaxBytes'] },
    ],
    expectedRevision: 7,
  })
  assert.ok(nodeText(renderSection(section, t)).includes('已保存'), '成功 notice')

  element = renderSection(section, t)
  findNode(element, (n) => n.type === 'select').props.onChange({ target: { value: 'auto' } })
  element = renderSection(section, t)
  findNode(element, (n) => n.type === 'button' && n.props.onClick).props.onClick()
  await tick()
  assert.equal(settings.calls.mutate.length, 2)
  assert.deepEqual(settings.calls.mutate[1], {
    ns: 'llm-pi-ai',
    ops: [
      { op: 'unset', path: ['titleLanguage'] },
      { op: 'unset', path: ['titleMaxBytes'] },
    ],
    expectedRevision: 8,
  })
})

const findBytesInput = (element) => findNode(element, (n) => n.type === 'input' && n.props.type === 'number')

test('设置分区：加载已存 titleMaxBytes → 输入框映射 + 当前行显示', async () => {
  const { state, settings } = applyBundle({ user: { titleLanguage: 'English', titleMaxBytes: 40 }, revision: 7 })
  const section = state.registers.find((r) => r.options.id === 'session-autotitle-settings').component
  const t = (k, params) => String(state.locale.dict.zh[k] ?? k).replace(/\{(\w+)\}/g, (m, n) => (params && n in params ? String(params[n]) : m))
  renderSection(section, t)
  await tick()
  const loaded = renderSection(section, t)
  const input = findBytesInput(loaded)
  assert.ok(input, '存在字节数输入框')
  assert.equal(input.props.value, '40', '已存 40 → 输入框 40')
  assert.equal(input.props.max, 80)
  assert.ok(nodeText(loaded).includes('≤ 40 字节'), '当前行显示字节数')
  assert.ok(settings.calls.describe === 1, '挂载时读取一次')
})

test('设置分区：应用 40 字节 → mutate set titleMaxBytes=40（与语言同批）', async () => {
  const { state, settings } = applyBundle({ user: {}, revision: 7 })
  const section = state.registers.find((r) => r.options.id === 'session-autotitle-settings').component
  const t = (k) => state.locale.dict.zh[k]
  renderSection(section, t)
  await tick()
  let element = renderSection(section, t)
  findBytesInput(element).props.onChange({ target: { value: '40' } })
  findNode(element, (n) => n.type === 'select').props.onChange({ target: { value: 'english' } })
  element = renderSection(section, t)
  findNode(element, (n) => n.type === 'button' && n.props.onClick).props.onClick()
  await tick()
  assert.equal(settings.calls.mutate.length, 1)
  assert.deepEqual(settings.calls.mutate[0], {
    ns: 'llm-pi-ai',
    ops: [
      { op: 'set', path: ['titleLanguage'], value: 'English' },
      { op: 'set', path: ['titleMaxBytes'], value: 40 },
    ],
    expectedRevision: 7,
  })
  const after = renderSection(section, t)
  assert.equal(findBytesInput(after).props.value, '40', '响应回读 40')
})

test('设置分区：字节数非法（999 / 空）→ 报错不发请求', async () => {
  for (const bad of ['999', '']) {
    const { state, settings } = applyBundle({ user: {}, revision: 7 })
    const section = state.registers.find((r) => r.options.id === 'session-autotitle-settings').component
    const t = (k) => state.locale.dict.zh[k]
    renderSection(section, t)
    await tick()
    let element = renderSection(section, t)
    const input = findBytesInput(element)
    if (bad !== '') input.props.onChange({ target: { value: bad } })
    else {
      // 清空：模拟输入框变为空串
      input.props.onChange({ target: { value: '' } })
    }
    element = renderSection(section, t)
    findNode(element, (n) => n.type === 'button' && n.props.onClick).props.onClick()
    await tick()
    assert.equal(settings.calls.mutate.length, 0, '非法字节数不写设置')
    assert.ok(nodeText(renderSection(section, t)).includes('请输入 1–80 之间的整数'), '显示校验错误')
  }
})

test('设置分区：自定义为空时应用 → 报错不发请求', async () => {
  const { state, settings } = applyBundle({ user: {}, revision: 7 })
  const section = state.registers.find((r) => r.options.id === 'session-autotitle-settings').component
  const t = (k) => state.locale.dict.zh[k]
  renderSection(section, t)
  await tick()
  let element = renderSection(section, t)
  findNode(element, (n) => n.type === 'select').props.onChange({ target: { value: 'custom' } })
  element = renderSection(section, t)
  findNode(element, (n) => n.type === 'button' && n.props.onClick).props.onClick()
  await tick()
  assert.equal(settings.calls.mutate.length, 0, '空自定义不写设置')
  assert.ok(nodeText(renderSection(section, t)).includes('请输入语言名称'))
})

test('设置分区：llm-pi-ai 命名空间缺失 → 提示而非崩溃', async () => {
  const { state } = applyBundle({ user: null })
  const section = state.registers.find((r) => r.options.id === 'session-autotitle-settings').component
  const t = (k) => state.locale.dict.zh[k]
  renderSection(section, t)
  await tick()
  const element = renderSection(section, t)
  assert.ok(nodeText(element).includes('未找到 llm-pi-ai'), '显示命名空间缺失提示')
})

test('remote.settings describe() 无参 + 扁平响应 → 加载已存值', async () => {
  const { state, settings } = applyBundle({ user: { titleLanguage: 'English' }, revision: 7 }, 'new')
  const section = state.registers.find((r) => r.options.id === 'session-autotitle-settings').component
  const t = (k, params) => String(state.locale.dict.zh[k] ?? k).replace(/\{(\w+)\}/g, (m, n) => (params && n in params ? String(params[n]) : m))
  renderSection(section, t)
  assert.equal(settings.calls.describe, 1, '挂载时读取一次')
  assert.deepEqual(settings.calls.describeArgs[0], [], 'describe 无参')
  await tick()
  const loaded = renderSection(section, t)
  const select = findNode(loaded, (n) => n.type === 'select')
  assert.equal(select.props.value, 'english', '扁平 {ok,value} 解析正确')
  assert.ok(nodeText(loaded).includes('当前：English'))
})

test('无 settings wire（remote 缺失）：分区跳过，header 按钮不受影响', () => {
  const { ctx, state } = makeClientCtx(null)
  loadCalls[0].factory(requireStub).apply(ctx)
  for (const inject of state.injects) inject.fn()
  assert.deepEqual(state.injects.map((i) => i.name), ['conversation.session.header.actions'])
  assert.equal(state.registers.length, 1)
})
