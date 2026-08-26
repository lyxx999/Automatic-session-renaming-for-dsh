/**
 * repatch-sidebar.mjs — 给已安装的 dsh-client-ui-workspace 客户端 bundle
 * 打“自动重命名”侧边栏菜单补丁（会话 … 菜单加一项，触发 /autotitle 命令）。
 *
 * 用法：node scripts/repatch-sidebar.mjs [目标 client.js 路径]
 *   默认目标：DSH Desktop 安装目录内的
 *   node_modules\@deepseek-ai\dsh-client-ui-workspace\lib\client.js
 *   环境变量：
 *     DSH_INSTALL_ROOT — 安装根目录（.../resources/app.asar.unpacked 或含
 *       node_modules 的目录），优先级低于命令行参数；
 *     DSH_HOME — 完成标记所在 profile 目录（默认 ~/.dsh）。
 *
 * 幂等：已打过补丁（存在 "id: \"autotitle\"" 标记）时直接退出 0。
 * 安全：写入前备份为 client.js.bak-<时间戳>；任一锚点缺失即中止且不写文件。
 * 注意：DSH 自动更新（dshmarket 替换 app.asar）会冲掉此补丁，更新后重跑本脚本。
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const REL_CLIENT = join('node_modules', '@deepseek-ai', 'dsh-client-ui-workspace', 'lib', 'client.js')
function defaultTarget() {
  if (process.env.DSH_INSTALL_ROOT) return join(process.env.DSH_INSTALL_ROOT, REL_CLIENT)
  if (process.platform === 'win32') {
    const local = join(process.env.LOCALAPPDIR ?? '', 'Programs', 'DSH Desktop')
    if (existsSync(join(local, REL_CLIENT))) return join(local, REL_CLIENT)
    const pf = String.raw`C:\Program Files\DSH Desktop\resources\app.asar.unpacked`
    return join(pf, REL_CLIENT)
  }
  return join(localDefault(), REL_CLIENT)
}
function localDefault() {
  return process.env.HOME ? join(process.env.HOME, '.dsh', 'install') : ''
}
const target = process.argv[2] || defaultTarget()
if (!existsSync(target)) {
  console.error(`[repatch-sidebar] 目标文件不存在: ${target}`)
  process.exit(1)
}
const source = readFileSync(target, 'utf8')

const MARKER = 'id: "autotitle"'
if (source.includes(MARKER)) {
  console.log('[repatch-sidebar] 已打过补丁（发现 autotitle 标记），无需操作。')
  process.exit(0)
}

/** 精确替换：锚点必须恰好出现一次，否则中止（上游 bundle 可能已变更）。 */
function patch(label, anchor, replacement) {
  const count = source.split(anchor).length - 1
  if (count !== 1) {
    console.error(`[repatch-sidebar] 中止：锚点「${label}」出现 ${count} 次（期望 1 次）。上游 bundle 可能已变更。`)
    process.exit(1)
  }
  // 替换到局部副本：全部锚点验证通过后才写盘
  return { label, anchor, replacement }
}

const T = '\t'
const patches = [
  // P1 菜单项：在 rename 条目后插入 autotitle
  patch(
    'P1 菜单项',
    `${T}${T}${T}${T}${T}id: "rename",\n${T}${T}${T}${T}${T}label: t("rename"),\n${T}${T}${T}${T}${T}icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {})\n${T}${T}${T}${T}},`,
    `${T}${T}${T}${T}${T}id: "rename",\n${T}${T}${T}${T}${T}label: t("rename"),\n${T}${T}${T}${T}${T}icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconEditOutline16, {})\n${T}${T}${T}${T}},\n${T}${T}${T}${T}{\n${T}${T}${T}${T}${T}id: "autotitle",\n${T}${T}${T}${T}${T}label: t("autotitle"),\n${T}${T}${T}${T}${T}icon: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSparkle16, {})\n${T}${T}${T}${T}},`,
  ),
  // P2 菜单选择分发
  patch(
    'P2 onSelect',
    `${T}${T}${T}${T}${T}${T}${T}${T}${T}if (id === "rename") onRename(node.id, row.title);`,
    `${T}${T}${T}${T}${T}${T}${T}${T}${T}if (id === "rename") onRename(node.id, row.title);\n${T}${T}${T}${T}${T}${T}${T}${T}${T}if (id === "autotitle") onAutoRename(node.id);`,
  ),
  // P3 SessionNodeItem 解构
  patch(
    'P3 SessionNodeItem 签名',
    'function SessionNodeItem({ node, currentId, now, onOpen, onRename, onFork, onArchive, drag, flat = false, t }) {',
    'function SessionNodeItem({ node, currentId, now, onOpen, onRename, onAutoRename, onFork, onArchive, drag, flat = false, t }) {',
  ),
  // P4 SessionTree 解构
  patch(
    'P4 SessionTree 签名',
    'onDeleteRequest, onSessionRename, onSessionArchive, insertWorkspaceBefore',
    'onDeleteRequest, onSessionRename, onSessionAutoRename, onSessionArchive, insertWorkspaceBefore',
  ),
  // P5 FlatList 解构
  patch(
    'P5 FlatList 签名',
    'open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds',
    'open, forkSession, onSessionRename, onSessionAutoRename, onSessionArchive, archivedSessionIds',
  ),
  // P6 SessionTree 渲染位（11 tab 缩进）
  patch(
    'P6 SessionTree 渲染位',
    `${T.repeat(11)}onRename: onSessionRename,\n${T.repeat(11)}onFork: forkSession,`,
    `${T.repeat(11)}onRename: onSessionRename,\n${T.repeat(11)}onAutoRename: onSessionAutoRename,\n${T.repeat(11)}onFork: forkSession,`,
  ),
  // P7 FlatList 渲染位（7 tab 缩进）
  patch(
    'P7 FlatList 渲染位',
    `${T.repeat(7)}onRename: onSessionRename,\n${T.repeat(7)}onFork: forkSession,`,
    `${T.repeat(7)}onRename: onSessionRename,\n${T.repeat(7)}onAutoRename: onSessionAutoRename,\n${T.repeat(7)}onFork: forkSession,`,
  ),
  // P8 WorkspaceBrowser 解构
  patch(
    'P8 WorkspaceBrowser 签名',
    'startSession, open, renameSession, forkSession',
    'startSession, open, renameSession, autoRenameSession, forkSession',
  ),
  // P9 onSessionAutoRename 定义（紧跟 onSessionArchive 定义）
  patch(
    'P9 onSessionAutoRename 定义',
    `${T}${T}${T}const onSessionArchive = (sessionId) => {\n${T}${T}${T}${T}archiveSession(sessionId).catch((reason) => {\n${T}${T}${T}${T}${T}console.warn("session archive rejected:", reason);\n${T}${T}${T}${T}});\n${T}${T}${T}};`,
    `${T}${T}${T}const onSessionArchive = (sessionId) => {\n${T}${T}${T}${T}archiveSession(sessionId).catch((reason) => {\n${T}${T}${T}${T}${T}console.warn("session archive rejected:", reason);\n${T}${T}${T}${T}});\n${T}${T}${T}};\n${T}${T}${T}const onSessionAutoRename = (sessionId) => {\n${T}${T}${T}${T}autoRenameSession(sessionId).catch((reason) => {\n${T}${T}${T}${T}${T}console.warn("session auto rename rejected:", reason);\n${T}${T}${T}${T}});\n${T}${T}${T}};`,
  ),
  // P10 browserInjected 注入 autoRenameSession
  patch(
    'P10 browserInjected',
    `${T}${T}${T}${T}renameSession: async (sessionId, title) => {\n${T}${T}${T}${T}${T}const session = ctx.sessions.binding(sessionId)?.session;\n${T}${T}${T}${T}${T}if (session === void 0) throw new Error(\`unknown session "\${sessionId}"\`);\n${T}${T}${T}${T}${T}const result = await session.rename(title);\n${T}${T}${T}${T}${T}if (!result.ok) throw new Error(result.error.message);\n${T}${T}${T}${T}},`,
    `${T}${T}${T}${T}renameSession: async (sessionId, title) => {\n${T}${T}${T}${T}${T}const session = ctx.sessions.binding(sessionId)?.session;\n${T}${T}${T}${T}${T}if (session === void 0) throw new Error(\`unknown session "\${sessionId}"\`);\n${T}${T}${T}${T}${T}const result = await session.rename(title);\n${T}${T}${T}${T}${T}if (!result.ok) throw new Error(result.error.message);\n${T}${T}${T}${T}},\n${T}${T}${T}${T}autoRenameSession: async (sessionId) => {\n${T}${T}${T}${T}${T}const session = ctx.sessions.binding(sessionId)?.session;\n${T}${T}${T}${T}${T}if (session === void 0) throw new Error(\`unknown session "\${sessionId}"\`);\n${T}${T}${T}${T}${T}const result = await session.command("/autotitle");\n${T}${T}${T}${T}${T}if (!result.ok) throw new Error(result.error.message);\n${T}${T}${T}${T}},`,
  ),
  // P11 FlatList 渲染 props（树视图分支，flat）
  patch(
    'P11 FlatList 渲染 props',
    `${T.repeat(7)}onSessionRename,\n${T.repeat(7)}onSessionArchive,\n${T.repeat(7)}archivedSessionIds,`,
    `${T.repeat(7)}onSessionRename,\n${T.repeat(7)}onSessionAutoRename,\n${T.repeat(7)}onSessionArchive,\n${T.repeat(7)}archivedSessionIds,`,
  ),
  // P12 SessionTree 渲染 props
  patch(
    'P12 SessionTree 渲染 props',
    `${T.repeat(7)}onSessionRename,\n${T.repeat(7)}onSessionArchive,\n${T.repeat(7)}forkSession,`,
    `${T.repeat(7)}onSessionRename,\n${T.repeat(7)}onSessionAutoRename,\n${T.repeat(7)}onSessionArchive,\n${T.repeat(7)}forkSession,`,
  ),
  // P13 中文词典
  patch(
    'P13 zh 词典',
    `${T}${T}${T}"rename": "重命名",`,
    `${T}${T}${T}"rename": "重命名",\n${T}${T}${T}"autotitle": "自动重命名",`,
  ),
  // P14 英文词典
  patch(
    'P14 en 词典',
    `${T}${T}${T}"rename": "Rename",`,
    `${T}${T}${T}"rename": "Rename",\n${T}${T}${T}"autotitle": "Auto rename",`,
  ),
]

// 在内存中依次应用（patch() 已验证每个锚点唯一）
let out = source
for (const { label, anchor, replacement } of patches) {
  out = out.replace(anchor, replacement)
}

// 语法自检：补丁后的文件必须仍是合法 JS（node --check，纯解析不执行）
const hash = createHash('sha256').update(out).digest('hex').slice(0, 12)
const dir = mkdtempSync(join(tmpdir(), 'dsh-repatch-'))
const staged = join(dir, 'client.js')
try {
  writeFileSync(staged, out)
  execFileSync(process.execPath, ['--check', staged], { stdio: 'pipe' })
} catch (error) {
  rmSync(dir, { recursive: true, force: true })
  console.error(`[repatch-sidebar] 中止：补丁后文件未通过 node --check，未写入。${error?.message ?? error}`)
  process.exit(1)
}
rmSync(dir, { recursive: true, force: true })
const backup = `${target}.bak-${hash}`
copyFileSync(target, backup)
writeFileSync(target, out)
// 完成标记：提权异步执行时供非提权侧轮询确认（安装目录不可被普通进程读取写入，
// 标记放在 profile 目录）。
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const marker = join(dshHome, 'profiles', 'session-autotitle', 'repatch.done.json')
writeFileSync(
  marker,
  JSON.stringify({ at: new Date().toISOString(), hash, target, backup, pid: process.pid }, null, 2),
)
console.log(`[repatch-sidebar] 已应用 ${patches.length} 处补丁 → ${target}`)
console.log(`[repatch-sidebar] 备份: ${backup}`)
console.log(`[repatch-sidebar] 标记: ${marker}`)
console.log('[repatch-sidebar] 完成后刷新浏览器页面（或重启 DSH）即可在会话 … 菜单看到“自动重命名”。')
