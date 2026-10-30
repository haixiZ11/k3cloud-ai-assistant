<p align="center">
  <img src="./resources/icon.svg" alt="金蝶云星空 AI 实施助手" width="96" />
</p>

<h1 align="center">金蝶云星空 AI 实施助手</h1>

<p align="center">
  <sub>项目名 OpenDeploy（开达）· 开源 · MIT · Windows 桌面应用</sub>
</p>
> **给金蝶云星空做二次开发，不用再打开 BOS Designer 一个个点。**
> 用中文说出需求，AI 直接把字段、单据体、Python 插件、工具栏按钮、转换规则写进你的云星空环境。

---
#### frok https://github.com/qiaolei227/opendeploy
## 这是什么

一个本地运行的 AI 智能体，专门干**金蝶云星空（Kingdee Cloud Cosmic / K3Cloud）V9 的二次开发**。

你填两样东西就能开工：云星空的服务器地址 + 账号，以及一个 LLM 的 API Key。然后在对话框里说人话：

> 给销售订单加一个「客户信用额度」字段，金额类型，必填，放在表头基本信息页签
>
> 销售订单保存时,如果含税金额超过客户信用额度就拦住,提示"超出信用额度 X 元"
>
> 把这个插件的校验逻辑写成 Python 表单插件,挂到保存操作上
>
> 再给销售订单列表加个按钮「导出当前筛选」,点了导出成 Excel

它会自己查内置的 BOS 知识库（字段类型枚举、插件事件名、wire 协议格式这些模型本来不知道的东西），算出该调哪个接口，然后通过 **BOS HTTP RPC 直接改你的云星空环境**。不用开 BOS Designer，不碰数据库，不用记 40 多个接口的参数顺序。

## 为什么不能直接用网页版 ChatGPT / Claude

因为「会写代码」和「能改到系统里」是两件事。模型缺三样东西：

| 缺什么 | 这个项目怎么补 |
|---|---|
| 不知道 BOS 的接口协议（`SaveForIDEV9` 的 wire 格式、字段类型枚举值、`FormAppearance` 结构） | 内置 13 个 skill / 75 份 markdown / 15943 行知识库，按需加载 |
| 不知道插件该挂哪个事件（`AfterSave` 还是 `BarItemClick`，参数签名长什么样） | 事件参考手册来自 BOS Designer 反编译实证，30+ 表单事件 + 列表插件 + 操作服务插件全覆盖 |
| 连不上你的云星空环境 | 40+ 个封装好的工具直接发 RPC，模型调用工具就能落地 |

普通 AI 对话到「给你一段 Python 代码」就停了，剩下的建字段、挂插件、加按钮还得你自己点。这个项目是从需求一路干到系统里生效。

## 功能

### 金蝶云星空 V9 二开（全程 BOS HTTP RPC，不接客户数据库）

- **新建 metaobject（BOS 模板继承）** —— 27 个模板覆盖 4 大 ModelType（单据 / 基础资料 / 账表 / 动态表单），wire 等价于 BOS Designer 的「新建向导 → 模板继承」
- **扩展生命周期** —— 新建 / 删除 / 列举
- **字段** —— 12 类：文本 / 数值 / 金额 / 数量 / 日期 / 复选 / 下拉 / 基础资料 / 助记码 / 计量单位 / 公式 / 物料属性
- **单据体** —— EntryEntity / TabPage / TabControl 的创建、删除、改名
- **Python 插件** —— 表单插件（30+ 事件）、列表插件、操作服务插件、账表服务端插件，支持批量挂载，产物落到项目目录
- **业务规则** —— Calculate / GetInvStock 等
- **自定义操作 + 工具栏按钮 + 列表菜单按钮**
- **单据转换规则** —— 通用化覆盖任意源/目标对象，支持扩展 + 转换插件
- **属性面板** —— 必填 / 默认值 / 显示行号 / 组织字段绑定 / 实体必填
- **账表配置** —— 过滤参数面板 + 报表列设置

### LLM 适配（自带 API Key）

Claude · GPT · DeepSeek · Qwen · GLM · Kimi · 豆包 · 混元 · MiniMax · 百川 · Ollama 本地

支持自定义 OpenAI 兼容端点（aihubmix / siliconflow 等中转站），模型列表从服务商接口自动拉取，设置页可一键测连通性。

### 知识库（随应用分发，可增量更新）

13 个 skill / 75 份 markdown / 15943 行，分三类：

- `common/` —— 实施流程方法论、系统化排障
- `k3cloud/` —— BOS 元素手册、二开决策树、metaobject 模板字典、Python 插件索引、字段类型、转换规则
- `system/` —— LLM 层不变量与已知坑、skill 自诊断

## 演示

<p align="center">
  <img src="./assets/wizard.gif" alt="首次配置" width="720" />
  <br/><sub>首次配置 —— 填 LLM 和云星空连接</sub>
</p>

<p align="center">
  <img src="./assets/project.gif" alt="创建项目" width="720" />
  <br/><sub>创建项目 —— 接入金蝶云星空标准版 / 企业版 V9</sub>
</p>

<p align="center">
  <img src="./assets/skills.gif" alt="skills 知识库" width="720" />
  <br/><sub>Skills 知识库 —— 实施方法论 + BOS 手册按需加载</sub>
</p>

<p align="center">
  <img src="./assets/case.gif" alt="真实定制闭环" width="720" />
  <br/><sub>真实定制闭环 —— 业务需求 → 插件落地</sub>
</p>

## 怎么开始

需要 Windows 10/11 + 一个 LLM API Key（Claude / DeepSeek / Qwen 等任意一个都行）。

**下载安装包（推荐）**

[**👉 v0.2.8-alpha 安装包**](https://github.com/haixiZ11/k3cloud-ai-assistant/releases/tag/v0.2.8-alpha) —— 下载 `OpenDeploy-*-x64-setup.exe` 双击安装。

**本地开发**

```bash
pnpm install
pnpm dev
```

## 环境要求

| 项 | 要求 |
|---|---|
| 操作系统 | Windows x64（macOS / Linux 暂无计划，视反馈） |
| 金蝶版本 | 云星空 V9 **私有部署版**（标准版 / 企业版均可）。V8 不兼容 —— 登录协议不同 |
| 金蝶账号 | 需要有 BOS 二开权限；密码不能是已过期状态 |
| 数据库 | **不需要**。全程走 BOS HTTP RPC，不连客户 SQL Server |
| LLM | 自带 API Key，按 token 计费，费用算在你自己账号上 |

## 架构与安全

- **零自营服务器** —— 没有云端中转，所有请求从你本机直连你的云星空和 LLM 服务商
- **凭据全部本地** —— 服务器地址、账号密码、API Key 明文存在本机 `settings.json`，渲染进程（界面）拿不到，只有主进程能读
- **不改客户库** —— 只走 BOS 提供的 HTTP RPC，等价于在 BOS Designer 里手工点出来的结果
- **操作可追溯** —— 每一轮工具调用都写 trace 日志，改了什么、调了哪个接口、耗时多久都有记录



## 当前状态

**v0.2.8-alpha** —— 上游同步 + 流式工具调用补全。近期主要变化：

- Claude 流式 tool call 改为整轮缓冲后再落历史，截断 / 畸形调用直接废弃整轮，不再执行半个工具调用
- BOS 登录不再从 `CheckPasswordPolicy` 推断「密码过期」，保留服务端原话，坏凭据保持未连接状态
- 取消后跳过队列中的工具，同时保证 `tool_use` / `tool_result` 配对完整、后续会话可回放
- 知识库清单跨平台字节可复现（`.gitattributes` 钉 LF、生成器拒绝 CRLF），运行时哈希归一化兜底 Windows 检出环境

83 个测试文件 / 994 个用例全绿，typecheck + lint 干净。

**这是面向 BOS 二开顾问的内部预览版**：功能、API、交互都还可能变。核心链路（连接、建字段、挂插件、加按钮）在真实云星空环境上跑通过，但边界场景未必覆盖全，建议先在测试账套上试。

## 开源协议

MIT —— 详见 [LICENSE](./LICENSE)
