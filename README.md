# @lyxx/dsh-session-autotitle

DSH 会话自动命名（profile 本地 bundle，更新免疫）。

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

插件无法注册新设置命名空间（api-proxy 的 exposedNamespaces 白名单门控），
故沿用 @hytime/dsh-thinking-effort 的 subagentEffort 惯例：存
`llm-pi-ai` 命名空间**用户层**顶层键 `titleLanguage` / `titleMaxBytes`
（pi-ai schema 忽略该键但原样持久化）。宿主经 `settings.describe()`
的 user 层读取，客户端经 `connection.api.settings.describe/mutate`
读写（revision 乐观并发）。思考接线自补齐只写 `providers` 字段，
不会冲掉这些键。

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
                      chat_template_kwargs.enable_thinking）
src/client.js         浏览器：会话头"自动重命名"按钮
                      （conversation.session.header.actions 插槽）+
                      设置分区"会话自动命名"（settings.section 插槽，
                      标题语言：跟随/中文/English/自定义；
                       标题最大字节数：1–80 整数，默认 80；zh/en/ja/ko）
test/                 单元测试（node --test，39 例：title 17 / host 11 / client 11）
```

## 思考关线的接线原理（本地 qwen 路由）

标题调用发 `reasoningEffort: 'off'`。dsh-llm 要求路由声明支持 `off`
（否则 UNSUPPORTED_REASONING_EFFORT）；pi-ai 路由上 `off` 被
`profileOptions` 折叠为"不发送 reasoning 字段"。宿主半区在挂载时幂等补齐
（并监听 `settings/updated`）：

1. 已声明 `reasoningEfforts` 但缺 `off` 的模型 → 补 `off: null`；
2. 推理模型且无思考 wire（`thinkingFormat` 未设置或 `chat-template` 缺参）
   的模型 → 补 `compat.thinkingFormat: 'chat-template'` +
   `chatTemplateKwargs.enable_thinking: {$var: thinking.enabled, omitWhenOff: false}`
   —— 有档位（主对话）→ `true`，off（标题调用）→ `false`。

实测（本机 vLLM qwen3.5-38b，2026-07）：无参数 64 token 预算下可见文本为空
（思考吞光，即之前的故障）；`enable_thinking: false` 后 8 token / 347ms 返回
干净标题。

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

1. **源码仓库**：推到 GitHub（如 `github.com/hytime/dsh-session-autotitle`），
   与 `repository` 字段一致。
2. **npm 发布**（需拥有 `@hytime` scope 的账号；否则改用自己的 scope）：
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
3. settings.yaml 中被自动补齐的 `off` 档位/`enable_thinking` 参数可留可删
   （留着的副作用：composer 里该模型多出 Off 档，无害）；
4. 重启 DSH。
