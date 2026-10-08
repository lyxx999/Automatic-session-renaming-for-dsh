# @lyxx/dsh-session-autotitle

DSH 会话自动命名（profile 本地 bundle，更新免疫）。

## 更新历史

- **0.2.5**（本次）：适配 DSH 0.2.0 的设置服务改造（entry-config 模型）。
  0.2.0 移除了 `settings.get()` 且写入只接受 volatile 路径——0.2.4 的思考
  接线自补齐因此静默失效（`llm-pi-ai` 未写入 `enable_thinking` wire），
  标题调用（256 token 预算）被思考吞光 → `/autotitle` 报
  "title output reached maxOutputTokens"。0.2.5 起：
  - 自补齐改为双设置模型兼容：`describe()` 读（value 判定 / user 层引用）、
    `mutate()` 写 `providers` volatile 子路径（整数组 op，不钉 schema 默认值），
    变更事件按模型探测（entry-config 发 `settings/document-updated`）；
  - 标题语言/字节数设置移入插件自有条目 `session-autotitle`
    （宿主半区导出的 `Config` schema 派生的设置节，根 volatile）；
    ≤0.1.6 宿主回退旧 `llm-pi-ai` 键。**注意**：0.2.0 下旧键的表单投影
    不含 `titleLanguage`/`titleMaxBytes`（schema 未声明），0.1.7 之前设置过
    的值在 0.2.0 宿主上不可见——升级后请在设置页重设一次。
- **0.2.4**：修复 v4 宿主的 source 拒收（见下）。

## 适配版本（DSH 兼容性）

- **当前版本适配：DSH ≥ 0.2.0-rc.2（会话格式 v4 + 0.2.0 设置模型）**。
  0.2.4 起标题请求
  消息的 source 写为 v4 producer-owned kind `plugin:dsh-session-autotitle`
  （未知第三方插件的 v4 规范写法，与 v3→v4 迁移对插件源的产出一致）。
  **原因**：v4 的写入路径（`dsh-session-format-v3-to-v4` 的
  `assertV4SourceRowAdmission`）拒收 0.2.3 沿用的退役 v3 裸包装
  `{ kind: 'plugin', plugin: … }`——0.2.3 因此在 v4 宿主上导致新会话
  首条提示词的整批落盘失败（agent turn failed、回退标题、projection
  cache 持续告警）。DSH < 0.2.0（v3 时代）请用 0.2.3。
- **最低 API 版本：DSH ≥ 0.1.2-rc.1**（宿主半区依赖 `@deepseek-ai/dsh-llm` 的
  `BlockAssembler` / `createUserMessage`、`@deepseek-ai/dsh-timeout` 的
  `deadline`、`@deepseek-ai/dsh-session-title` 的
  `SessionTitleProviderId` / `normalizeSessionTitle`，以及
  `sessionTitle` 服务的 `register` 提供方 API——均为 0.1.2-rc.1 已核对的导出）。
- `deepFreeze` 来自 `@deepseek-ai/dsh-util-values`（**不是** dsh-llm 的导出，
  dsh-llm 仅内部使用）；0.2.3 已修正导入来源。
- **客户端**（设置分区 + 会话头按钮）需 DSH 0.1.2 起的新设置线
  `ctx.remote.settings`（旧线 `connection.api.settings` 已带回退）。
- 更早版本（< 0.1.2-rc.1）：宿主半区可能因缺少上述导出而加载失败，
  客户端设置区可能不渲染。安装前请确认 DSH 版本 ≥ 0.1.2-rc.1。

## 功能

1. **手动触发**：会话头操作行的"自动重命名"按钮，或会话内输入 `/autotitle`
   命令。点击/发送后 LLM 总结整个会话的用户消息并重新命名；
   有意覆盖用户手动钉住的标题（与手动重命名同级）。
2. **自动触发**：
   - 用户发送**第一条提示词**后自动总结命名（继承基线时序，但现在用
     全消息 provider，且标题调用关思考——修复了之前思考吞掉 64 token
     导致永远只剩回退标题的问题）；
   - 用户在顶层会话调用 **`/handoff`**（handoff 技能）时自动重命名；
     用户手动钉住的标题（`source.kind === 'user'`）跳过。

3. **标题设置**：设置页新增"会话自动命名"分区（在"模型能力与档位"
   下方），两项：
   - **标题语言** = 跟随消息语言（默认）/ 中文 / English / 自定义
     （任意语言名，如"日本語"）。生成时所选语言写入系统指令；
    - **标题最大字节数** = 1–80 整数（默认 80）。系统指令要求模型
     在该字节预算内出题，生成后按此值在 UTF-8 字符边界截断
     （80 为 session-title 服务侧硬上限，超出仍会被服务截断）。

标题约定：默认 ≤ 80 UTF-8 字节（约 26 个汉字，可在设置中调小），
纯文本无引号。

### 标题设置的存储

- **DSH 0.1.7+（含 0.2.0 entry-config 模型）**：存插件自有条目
  `session-autotitle`（宿主半区导出的 `Config` schema ——
  `titleLanguage` / `titleMaxBytes`，根 volatile）派生的设置节。
  原因：0.2.0 下 `llm-pi-ai` 的 Config 只声明 `providers` 为 volatile，
  旧键既读不到（表单投影剥离）也写不进（volatile 路径门禁拒绝）。
- **DSH ≤ 0.1.6（namespace 模型）**：回退存 `llm-pi-ai` 用户层顶层键
  `titleLanguage` / `titleMaxBytes`（与 @hytime/dsh-thinking-effort 的
  subagentEffort 同一惯例）。
- 宿主侧读取自有条目优先、旧键回退；客户端经设置 wire
  `describe()`/`mutate()` 读写（revision 乐观并发），目标节由
  `describe()` 返回的节列表解析（自有节优先）。思考接线自补齐只写
  `providers` volatile 子路径，不会冲掉这些键。

失败策略：手动触发 → 会话内一行错误 + 宿主日志；自动触发 → 仅宿主日志。

## 组成

```
package.json          包清单（dsh.bundle.patch + dsh.client 声明）
cordis.patch.yml      组合补丁：禁用基线 session-title-llm 行；
                      插入 session-title-autotitle（title 提供方）与
                      session-autotitle（命令/钩子/自补齐）两行
src/title.mjs         宿主：全消息标题提供方（首条锚点+最近窗口，
                      16KB 预算；reasoningEffort 'off' + 不支持时回退）
src/host.mjs          宿主：/autotitle 命令、/handoff 手势钩子、
                       llm-pi-ai 路由思考接线自补齐（off 档位 +
                       chat_template_kwargs.enable_thinking；
                       双设置模型：describe 读 / mutate 写 volatile
                       子路径 / 模型探测变更事件）、导出 Config
                       （插件自有设置节，0.1.7+）
src/client.js         浏览器：会话头"自动重命名"按钮
                      （conversation.session.header.actions 插槽）+
                      设置分区"会话自动命名"（settings.section 插槽，
                      标题语言：跟随/中文/English/自定义；
                       标题最大字节数：1–80 整数，默认 80；zh/en/ja/ko）
test/                 单元测试（node --test，46 例：title 20 / host 13 / client 13）
```

## 思考关线的接线原理（本地 qwen 路由）

标题调用发 `reasoningEffort: 'off'`。dsh-llm 要求路由声明支持 `off`
（否则 UNSUPPORTED_REASONING_EFFORT）；pi-ai 路由上 `off` 被
`profileOptions` 折叠为"不发送 reasoning 字段"。宿主半区在挂载时幂等补齐
（带重试，并监听设置变更事件——按设置服务模型探测：0.2.0 entry-config
模型发 `settings/document-updated`，旧 namespace 模型发 `settings/updated`）。
读取经 `describe()`（value 层判定缺什么、user 层提供引用），写入经
`mutate()` 的 `providers` volatile 子路径（models 数组容器整体写；载荷只
引用用户层条目，不钉 schema 默认值）：

1. 已声明 `reasoningEfforts` 但缺 `off` 的模型 → 补 `off: null`；
2. 推理模型且无思考 wire（`thinkingFormat` 未设置或 `chat-template` 缺参）
   的模型 → 补 `compat.thinkingFormat: 'chat-template'` +
   `chatTemplateKwargs.enable_thinking: {$var: thinking.enabled, omitWhenOff: false}`
   —— 有档位（主对话）→ `true`，off（标题调用）→ `false`。

实测（本机 vLLM qwen3.5-38b）：2026-07，无参数 64 token 预算下可见文本为空
（思考吞光，即当时的故障）；`enable_thinking: false` 后 8 token / 347ms 返回
干净标题。2026-10 复测（0.2.0 宿主）：256 token 预算下不发参数 →
finish_reason `max-tokens`（约 100 token 被思考吞掉，可见文本为空，即
"title output reached maxOutputTokens" 的成因）；发
`chat_template_kwargs: {enable_thinking: false}` → 15 token / 267ms 干净标题。

## 安装（已在本机 desktop profile 完成）

1. `profiles/desktop/package.json`：
   `dependencies` 加 `"@lyxx/dsh-session-autotitle": "file:../session-autotitle"`，
   `dsh.profile.bundles` 追加包名（在 dsh-web-app 之后）。
2. `pnpm install --dir profiles/desktop`。
   注意：pnpm 对 file: 依赖不感知新目录（如 test/），需手动同步到
   `profiles/desktop/node_modules/@lyxx/dsh-session-autotitle/`
   （复制即可；源码目录为唯一真相源）。
3. 重启 DSH Desktop（bundle 集变化需要重启）。

## 修改与测试

```powershell
# 单测（在包目录；发布前 npm pack 后可用包内 test/ 跑，@deepseek-ai/* 由
# 宿主 profile 的 node_modules 提供）
node --test test/title.test.mjs test/host.test.mjs test/client.test.mjs

# 组合树离线验证（<安装根> = DSH Desktop 安装目录下的 resources/app.asar.unpacked）
$env:DSH_HOME='<~/.dsh>'
node '<安装根>\node_modules\@deepseek-ai\dsh\lib\bin.js' --profile desktop --dump-config
```

## 发布 / 分发

本包即标准 npm 包（`dsh.bundle` manifest + `dsh.client` 声明），发布流程：

1. **源码仓库**：推到 GitHub（`github.com/lyxx999/Automatic-session-renaming-for-dsh`），
   与 `repository` 字段一致。
2. **npm 发布**（需拥有 `@lyxx` scope 的账号）：
   ```bash
   npm login            # 或 NPM_TOKEN 环境变量
   npm publish          # publishConfig.access=public 已声明
   ```
3. **他人安装**：DSH Desktop 的市场（dshmarket）装的就是 npm 包——
   市场搜 `@lyxx/dsh-session-autotitle` 安装即可；或手动：
   `pnpm add @lyxx/dsh-session-autotitle`（profile 目录）+
   `dsh.profile.bundles` 追加包名 + 重启。

## 卸载

1. `profiles/desktop/package.json` 移除依赖与 bundle 条目 → `pnpm install`；
2. 删除 `profiles/session-autotitle/` 目录；
3. cordis.patch.yml 中被自动补齐的 `off` 档位/`enable_thinking` 参数可留可删
   （留着的副作用：composer 里该模型多出 Off 档，无害）；0.1.7+ 宿主下
   插件自有条目里的 `titleLanguage`/`titleMaxBytes` 亦可删；
4. 重启 DSH。
