<p align="center">
  <a href="./README.md">English</a> &middot; <a href="./README.zh.md"><b>简体中文</b></a>
</p>

# dsh-harbor

harbor 是你已安装的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件的一面只读镜子：每个插件**能做什么**、它们在哪里互相**冲突**、自上次扫描以来**变了什么**——每一条结论都附 `file:line` 证据。

要不要清理、清理什么，由你决定。harbor 只陈述事实：不评判、不把关安装、不拦截任何东西。

## 它是什么，不是什么

harbor 只做一件事：为已安装的插件维护一本持续更新、带证据的事实台账。这本台账有三栏——在册清单本身（每个已安装的第三方插件，每条能力结论背后都有 `file:line` 出处）、每个插件"声明了什么"与"代码实际做了什么"的对账，以及两次扫描之间的变化时间线。

它明确不做什么，同样属于设计的一部分：不做装前准入把关——那是插件市场类工具的领域；不下上游依赖监控的深水区——上游检查只覆盖插件自身的版本，到此为止；不做通用代码审计；也不拦截、阻断或沙箱任何插件行为。

其中"不拦截"不是能力取舍，而是宿主的事实。DSH 的 Cordis 运行时没有插件能力沙箱：插件运行在宿主的主 Node realm 里，持有与宿主相同的权限。harbor 能做到**看见**、**检出**、**对账**，但做不到"关得住"。约束插件行为需要 DSH 加载器本身的支持——下文这套声明流程，就是用数据去推动这个标准，而不是空口论证。

最后，harbor 只出事实，不出评分。它的输出永远是"检出了什么 + 证据在哪一行"，从不给出风险等级或质量评分。一项发现对你意味着什么，是你的判断，不是 harbor 的。

> **状态：`0.1.0-rc.1`，候选发布版。** `harbor scan` / `harbor manifest`、仅回环的 hub 路由、DSH 设置面板，以及两条版本轴——跨 profile 漂移与可选的上游检查——都已可用；运行时注册表证据已接入，但在没有活动宿主时会降级为 `available: false`。功能面已完整，尚早的是检测器在更广生态上的校准——这正是 rc 阶段该做的事。

## 它看什么

```
~/.dsh/profiles/*                → 已安装的第三方 bundle（npm 与 link: 一视同仁）
  ├─ declared    package.json / cordis.patch.yml —— 插件对自己的描述
  ├─ runtime     宿主里实际注册的 tools / routes / providers / waterfalls
  ├─ static      子进程、网络出站、改写外部配置 —— 带 file:line
  ├─ versions    漂移（本地，始终计算）+ 上游（联网，可选）
  └─ snapshot    与上次扫描做 diff：新版本、新能力
        └─ 对账: 声明的 dsh.capabilities vs 实际检出
```

能力是一个固定的集合，共 13 项——客户端注入、realm 风险、realm 副本、全局钩子、LLM 适配器、子进程、网络出站、Web 路由、工具注册、MCP 服务、外部配置读写、凭据处理、环境变量读取。之所以固定，是为了让不同扫描之间的报告可以互相比较、可以 diff。权威清单见 [SPEC.zh.md](./SPEC.zh.md) §2（英文版 [SPEC.md](./SPEC.md)）；机器可读的事实源在 `src/scan/detectors.mjs`。

措辞刻意中性：叫"能力"，不叫"风险"。起子进程对某些插件来说就是它存在的全部意义。报告回答"它能做什么"，把"该不该让它做"留给你。

## 版本

harbor 回答两个版本问题，并刻意把它们分开。

**跨 profile 漂移**纯粹是本机事实。同一个插件在不同 profile 里版本不一致，是这台机器上的一个事实，所以每次扫描都会计算，零成本。`link:` 或 `file:` 安装不算"最新"基线：工作树跑在已发布版本前面是常态，不是漂移。

**上游检查**会离开这台机器，所以永远不在默认扫描里。CLI 需要 `harbor scan --check-updates`；面板需要一次显式按钮点击，按钮旁的说明文字也写明了——它是本页唯一会离开你机器的动作。每条结果属于五种状态之一：

- **behind** —— registry 上有更新版本
- **current** —— 已装版本与 registry 一致
- **ahead** —— 已装版本比 registry 新（维护者机器上的真实状态）
- **local** —— `link:` / `file:` 安装，没有上游可比，也从不显示为"已是最新"
- **unknown** —— 查询失败

registry 读取自你自己的 `.npmrc`（包括 `@scope:registry` 覆盖），从不硬编码 npmjs。结果在磁盘上缓存六小时。

## 安装

包目前尚未发布到 registry，先从本地 checkout 安装：

```bash
dsh plugin --profile web add link:/path/to/dsh-harbor
```

`dsh plugin` 会把剩余参数转发给 profile 目录内的 pnpm；`link:` 把 profile 依赖符号链接到这份 checkout，改动即时可见。待 `@zseven-w/dsh-harbor` 发布后，用普通的 registry 形式：

```bash
dsh plugin --profile web add @zseven-w/dsh-harbor@latest
```

安装后重启 DSH，让新的 profile 层生效。

面板入口在 DSH Web UI 的「设置」页，名为 **DSH Harbor**——与 CLI 是同一面镜子：带证据的清单、冲突、版本、自上次扫描以来的变化。它的「检查上游更新」按钮是本页唯一会离开你机器的动作。面板属于插件 hub 的一半，只在带 Web 服务的 profile 里挂载；纯无头环境仍可使用完整 CLI。

## 用法

```bash
harbor scan                 # 清单、冲突、自上次扫描以来的变化
harbor scan --check-updates # 加上可选的 registry 上游检查（联网）
harbor manifest ./my-plugin # 为你的插件起草 dsh.capabilities 块
```

加 `--evidence` 逐条打印每条能力的 `file:line` 出处，`--json` 输出完整机器可读报告，`--no-snapshot` 跳过写入 diff 基线。

扫描器零依赖，不需要安装 DSH，所以也能跑在 CI 里。

## 给插件作者

`harbor manifest` 用读别人插件的方式读你的插件，为你的 `package.json` 起草一份 `dsh.capabilities` 块。声明之后，harbor 的检查就变成**声明 vs 检出**：声明了却从不使用的能力，是可以修剪的噪音；检出了却没声明的能力，才是值得解释的部分。harbor 自己也声明了 `dsh.capabilities`，所以这套流程可以在它自己身上复现：在本仓库里跑 `harbor manifest .`。

公约本身写在 [SPEC.zh.md](./SPEC.zh.md)（英文版 [SPEC.md](./SPEC.md)）。一句话：`dsh.capabilities` 是 `package.json` 里的一个普通列表，声明你的插件代码实际会做什么。声明它很便宜，回报有两份——像 harbor 这样的审计工具可以把你的声明与代码对账，用你插件的人一眼就能看出你没有藏东西。任何时候都可以用 `harbor manifest <dir>` 自验。

## 边界，平实说清

harbor 会读每一个插件的源码，这让它成为房间里权限最高的那个。它自己也会出现在自己的报告里。

一旦启用上游检查，harbor 自己就具备网络出站能力——它的 `dsh.capabilities` 声明里已经列了这一条。

## License

MIT
