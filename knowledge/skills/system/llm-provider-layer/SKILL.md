---
name: llm-provider-layer
title: LLM 供应商层不变量与已知坑
description: 修改 OpenDeploy 自身的 LLM 供应商、设置存储或模型选择逻辑之前加载本 skill。记录内置模型目录的快照设计与三层防漂移机制(自动拉取 / 自定义 id 原样透传 / 自由输入),以及各设置字段(密钥、模型名、Base URL)的读写对称表——含 2026-08-29 实证修复的自定义模型读写不对称 bug(customOpenAI.* 专属字段 vs 通用桶)。防止新增供应商或重构设置时重新踩雷。
version: 1.0.0
category: troubleshooting
---

# LLM 供应商层不变量与已知坑

实证日期 2026-08-29。适用范围:OpenDeploy 自身代码(`src/renderer` 的 provider 数据与设置、`src/main/llm` 的请求路由),不是 K/3 Cloud 领域知识。

## 不变量 1:内置模型目录是快照,不是权威

`src/renderer/data/providers.ts` 的 `PROVIDERS[].models` 是**随版本发布固化的快照**。厂商上新、改名、调价、下线都不会自动同步进来——这是设计如此,不是待修的 bug。

三层防漂移机制保证"厂商改了模型名,功能照样能用"。改动 LLM 层之前先理解它们,**不要"顺手修复"破坏任何一层**:

1. **目录自动拉取(主防线)**:设置页选中供应商后调 `llmListModels`(OpenAI 兼容 → `GET /models`,Anthropic → `/v1/models`,Ollama → `/api/tags`,分发逻辑在 `src/main/llm/factory.ts` 的 `listModelsForProvider`),线上真实 id 合并进下拉框(SettingsPage 的 `mergedModels`,与内置目录去重)。
2. **自定义 id 原样透传(兜底防线)**:`resolveActiveModel` 对不在内置目录里的 stored id 返回**降级元数据**(上下文按 128K 保守估计、价格显示"—")而不是丢弃——该 id 必须原样发到 API。把这个 fallback 改成"过滤未知模型"是错的,这正是 custom-model escape hatch 的设计意图。
3. **自由输入**:Ollama(`ollamaModelInput`)和 custom-openai(`customOpenAI.model`)是自由文本输入框 + 已拉取 id 的 datalist 补全。

会随时间过时的只有**展示元数据**(价格、上下文窗口、推荐标记、默认选中项),最坏情形是默认选中项指向已下线模型、首次请求报错后用户手动换一个——不影响"模型可用"本身。

## 不变量 2:设置字段读写必须对称(实证踩坑)

设置有两套存储桶,`settings-store.ts` 的 setter 对 custom-openai / ollama 做了 provider 特判,**读取方很容易漏掉同样的特判**:

| 数据 | 存储位置 | 注意 |
|---|---|---|
| 通用按量密钥 | `apiKeys[providerId]` | |
| 包月密钥 | `planApiKeys[providerId]` | |
| **custom-openai 密钥** | `customOpenAI.apiKey`(**不是** `apiKeys`) | setter `setApiKey` 特判写入 |
| **custom-openai 模型名** | `customOpenAI.model`(**不是** `modelByProvider`) | setter `setModel` 特判写入 |
| Base URL 覆盖 | `apiBaseUrlOverride[providerId]` | `customOpenAI.baseUrl` 是旧字段,仅作兜底读取 |
| Ollama 模型名 | `ollamaModelInput` | 自由文本 |
| 其余供应商模型选择 | `modelByProvider[providerId]` | 读侧一律走 `resolveActiveModel()` |

**2026-08-29 实际踩过的雷**(已修复):custom-openai 的密钥写入 `customOpenAI.apiKey`,但三处读取方读的是 `apiKeys['custom-openai']`——聊天(Composer)发空密钥直接 401、连通性测试拿不到密钥、目录拉取提前 return 永远拉不到;目录拉取的 baseUrl 读旧字段 `customOpenAI.baseUrl` 而保存写的是 `apiBaseUrlOverride`;`App.tsx` 首启检查读错密钥桶导致用户被反复拉回向导。三处全是"写有特判、读没跟上"。

**纪律**:动 `settings-store.ts` 任何一个 setter,或新增任何读设置的代码时,grep 该字段的**全部读写点**(`customOpenAI` / `apiKeys` / `planApiKeys` / `modelByProvider` / `ollamaModelInput` / `apiBaseUrlOverride`),逐一对称核对。新增 provider 时先明确回答三个问题:密钥、模型名、Base URL 各存在哪个桶?

## 检查清单:改 LLM 层之前

1. 新增/修改 provider:renderer 的 `providers.ts` 与 main 的端点解析(`factory.ts` 的 `resolveProviderEndpoint` / `PROVIDER_CONFIGS`)必须同步,护栏测试 `tests/llm/provider-sync.test.ts`。
2. 密钥 / 模型名 / Base URL 三件套:对照上表核对写读双方。
3. 自定义 id 透传链路别断:`resolveActiveModel` 的降级分支 + 各输入框的 blur 保存。
4. 改完跑 `pnpm typecheck` + `pnpm test`。

关键文件:`src/renderer/data/providers.ts` · `src/renderer/stores/settings-store.ts` · `src/renderer/stores/chat-store.ts`(请求前模型解析)· `src/renderer/pages/SettingsPage.tsx` · `src/renderer/components/Composer.tsx`(聊天密钥)· `src/main/llm/factory.ts`(端点与目录拉取)。
