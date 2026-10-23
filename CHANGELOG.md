# CHANGELOG

## v0.2.7-alpha (2026-10-22)

### LLM 层
- 模型目录自动获取 —— 从各 provider 的 `/models` 端点拉取真实可用模型列表,不再靠硬编码清单;失败时回退内置默认值。
- 自定义模型名 —— 允许在设置里手工填写模型 ID,兼容中转站 / 私有网关的别名。
- 连通性测试 —— 设置页可对当前配置做一次真实请求探测,直接看到延迟与错误原因。
- 自定义 OpenAI 兼容服务 —— 可接 aihubmix / siliconflow 等兼容 OpenAI 协议的中转站(专属字段:Base URL / API Key / 模型名)。
- 首次启动向导可跳过。

### 修复
- 修 Claude 多轮工具调用 400 —— assistant 历史里缺失 `tool_use` 块回放,导致第二轮请求被 Anthropic 拒绝。
- 修对话「停止」失灵、IME 输入法回车误发、请求失败后一直转圈。
- 流式渲染节流,长回答不再整屏重排。

### UI / UX
- 导航文字化 + 蓝色主题 + 项目快捷切换器 + 沉浸式标题栏(frameless)。
- 代码块支持一键复制。

### 知识库
- 新增 `system/llm-provider-layer` skill —— 沉淀 LLM 层不变量与已知坑。
- `k3cloud/python-plugin-index` —— 补充手工注册 Python 插件的已知坑,澄清「类式写法不执行」是路径差异而非版本变更,细化三层根因;确立函数式默认写法。

### 测试
915+ 单元 / wire-replay 测试, lint clean。

---

## v0.2.0-alpha (2026-05-14)

### 新工具 (2 个)
- `k3cloud_create_from_template(templateId, newFormId, name, subSystemId)` — 通过 BOS 自带模板继承创建新 metaobject(账表 / 单据 / 基础资料 / 动态表单)。复用 SaveForIDEV9 wire 路径,跟 k3cloud_create_extension 同一条路径。
- `k3cloud_register_sysreport_python_plugins(formId, className, pyBody)` — 往 SysReport 账表挂 IronPython 服务端插件(AbstractSysReportServicePlugIn 子类)。

### 新 skill
- `k3cloud/metaobject-creation-index` — 全 BOS_* 模板字典(账表 6 + 单据 5 + 基础资料 7 + 动态表单 9 = 27 个) + 新建 vs 扩展决策树 + wire 格式参考。

### Plan 7 系列(本次发版总览)
- **7.0 转换规则通用化** — 之前只支持 SaleOrder→OutStock,现可覆盖任意源/目标对象
- **7.1 表单插件 events-reference 扩到 30+** — BOS Designer 反编译实证
- **7.2 列表插件 + 列表菜单按钮** — FormAppearance.ListMenu 完整支持
- **7.3 操作服务插件 events-reference + SKILL** — 3 个 knowledge/routing bug 修完
- **7.4 账表 knowledge bridge** — events-reference 解锁(本版完整闭环)
- **7.6 创建新 metaobject(账表+单据+基础资料)** — 通过 BOS 模板继承,2 工具 + 1 skill + 5 层测试全过
- **7.7 创建动态表单 (DynamicForm)** — 9 个 BOS_* 模板(过滤器/列表/向导/参数对话框/页面部件),mock + 真服务器 e2e 各 3/3,readback 实证 readbackOid === templateId

### 测试
73 test files / 887 tests, 全绿。lint clean。

### 已知限制
- 树形账表 / 直接SQL 账表 / 透视表 / WNReportForm 万能账表 — 留 v0.3
- v0.2 工具不固化 P0 templateId — LLM 按场景选择

---

## v0.1.0-alpha.1 (2026-05-09)

首个 Alpha 发布。核心能力:

- Electron 41 + React 19 + TS 6 应用壳，含 LLM 对话 UI
- 多 LLM 提供商支持(Claude / GPT / DeepSeek / Qwen / GLM / Kimi / 豆包 / 混元 / MiniMax / 百川 / Ollama)
- K/3 Cloud V9.x BOS HTTP RPC 读写:字段 / 操作 / 工具栏按钮 / entry / tabpage / 转换规则 / 业务规则
- Skills 知识库基础设施(GitHub/Gitee 分发,零服务器)
- Python 插件代码生成 + BOS 注册闭环
- 10 bundled skills / 57 md / 10638 行,43 个 k3cloud_* tools
- 71 test files / 869 tests,lint clean
- NSIS Windows installer
