# dsh.capabilities — DSH 插件能力声明公约

性质：社区公约（不属于 DSH 宿主 API）
参考实现：dsh-harbor 0.1.0-rc.1

`dsh.capabilities` 让插件作者在 `package.json` 里声明：自己的代码实际
使用了哪些能力。声明是对行为的事实陈述——不是权限申请，也不是安全边界。
DSH 宿主不读取、不强制该字段；它的消费者是审计工具（dsh-harbor），由后者
把声明与静态检测结果做对账。

## 1. 字段定义

| 项   | 值 |
| ---- | --- |
| 位置 | `package.json` 中的 `dsh.capabilities` |
| 类型 | `string[]` —— 由 §2 词表中的能力 id 组成的数组 |
| 语义 | 声明插件代码实际会做的事 |

harbor 自己 `package.json` 里的真实声明：

```json
{
  "dsh": {
    "capabilities": [
      "client-injection",
      "env-read",
      "foreign-config",
      "network-egress",
      "web-routes"
    ]
  }
}
```

## 2. 能力词表

词表以数据形式存在于 harbor 源码（`src/scan/detectors.mjs` 的
`CAPABILITIES`）。每个 id 对应一种可观测行为。以下是 harbor 0.1.0-rc.1
检测的全部 13 个 id：

| id | 该 id 代表的含义（检测所依据的行为） |
| --- | --- |
| `client-injection` | 向 DSH Web UI 注入浏览器端模块（`package.json` 存在 `dsh.client`）；这类模块可访问页面内的一切 |
| `realm-risk` | 把 `@deepseek-ai/*` 写进 `dependencies` 而非 `peerDependencies`；安装时可能拉入副本 |
| `realm-copy` | 插件自己的 `node_modules` 下自带 `@deepseek-ai/*` —— Symbol 身份分裂的直接成因 |
| `global-hook` | 挂载 host 级瀑布钩子（`ctx.on('agent/…'|'session/…'|'llm/…')`），可读取甚至改写所有 agent 消息；UI 事件不计入 |
| `llm-adapter` | 注册模型 provider（`registerAdapter([…])`）；会话选中后全部模型流量经其转发 |
| `subprocess` | 引入 `child_process` 并调用 `spawn`/`exec`（含 `*Sync`/`File` 变体）——起本机进程，权力等同于用户自己的 shell |
| `network-egress` | 主动向外发请求（`fetch(`、`http(s).request(`、对 `fetch` 的引用）；报告会列出所扫代码中出现的主机名 |
| `web-routes` | 在 DSH 的 Web 服务上挂载路由（`webServer.register(`，通常限回环） |
| `tool-registration` | 向模型暴露工具（name+description 工具对象、`*_TOOL_NAME` 常量）；启发式——工具名同时进入冲突矩阵 |
| `mcp-server` | 引入 `@modelcontextprotocol/sdk` —— 对 DSH 之外的宿主（Claude Code、Codex 等）提供 MCP 服务 |
| `foreign-config` | 读写其它软件的配置（含 `.claude`/`.codex`/`.gemini`/`.npmrc` 的路径）；卸载残留也从这里查 |
| `credential-handling` | 代码中出现凭据相关处理（`_authToken`、`api-key`/`api_key`、`Bearer`）；启发式——是否合理看上下文 |
| `env-read` | 读取环境变量（`process.env.X`）；报告列出变量名 |

## 3. 对账语义

harbor 把声明与检出逐项比对，每个 id 归入三类：

- **undeclared（检出未声明）**——检出了但没声明（缺声明）→ 状态 `drift`
- **unused（声明宽于实际）**——声明了但没检出（过度声明）→ 会报告，但
  **不构成 drift**：声明得比实际宽是保守行为，允许
- **unknown（未知 id）**——声明的 id 不在词表里（拼写错误、过期 id）→
  状态 `drift`

整体状态有三种：`not-declared`（没有该字段）、`match`、`drift`。

`harbor scan` 中的呈现（中文界面原文）：

```text
声明对账: 未声明 dsh.capabilities
声明对账: ✓ 一致（声明宽于实际: <ids>）
声明对账: ⚠ 检出未声明: <ids> | 未知 id: <ids>
```

`harbor manifest` 在一致时输出 `现有声明与检出一致。`；不一致时输出
`与现有声明的差异:` 块，列出检出未声明 / 未知 id。

## 4. 未知能力名

harbor 现状：未知名称**会被报告，不会被忽略**——进入 `unknown` 数组，
使状态成为 `drift`，呈现为 `未知 id: …`。报告是提示性的：drift 不会
让命令以非零码退出。

## 5. 作者自验

```text
node src/cli.mjs manifest <dir>     # 在源码 checkout 中
harbor manifest <dir>               # 安装 harbor 之后
```

输出检出能力数、可直接粘贴的 `dsh` 块、逐条核对说明，以及（当插件已有
声明时）对账结论。检测是模式匹配：可能多报（注释、示例代码）或漏报
（动态调用）。粘贴前请逐条核对。

**在你自己的源码 checkout 上自验，不要拿发布后的包自验。** harbor 优先
扫描作者源码，会排除打包产物（`dist/`、`build/` 等）与测试文件——否则
报告的是你打包进来的第三方库，不是你自己的代码。当一个包只发布产物、
不发布源码时，harbor 会降级去扫产物，并把整份报告标记为
`coverage.sourceKind: 'bundled'`，证据加"(产物)"标签、置信度降为
heuristic。这类结论仍然可用，但它描述的是打包后的整体，含被 bundle
进去的依赖，不等同于你的作者意图。

## 6. 词表演进

1. 新检测器以新增 id 的形式追加进 `CAPABILITIES`。id 只为新的可观测
   行为引入，含义在引入时固定。
2. 已有 id 永不更名、永不删除、永不被重新定义。按当前词表写下的声明
   长期有效。
3. 旧声明永不成为错误。旧版 harbor 检测不到的 id 呈现为 `unused`——
   状态仍为 `match`；旧版 harbor 不认识的 id 呈现为 `unknown` drift——
   被报告，但只是提示。（两条均已对照 harbor 0.1.0-rc.1 源码验证。）
4. harbor 自己的声明（§1）是参考示例，必须始终对自身对账为 `match`。
