<p align="center">
  <img src="./resources/icon.svg" alt="OpenDeploy" width="96" />
</p>

<h1 align="center">开达 OpenDeploy</h1>

> An open-source AI agent for ERP implementation consultants — making "a one-person delivery team" possible.

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

Most "AI assistant tools" today look like this:

> **Consultant**: The client wants an xxx feature.
>
> **AI**: Sure, I'll write the Python plugin.
>
> **Consultant**: ...but the field needs to be created in the system first, and the approval flow edited too.
>
> **AI**: That part's on you.

**What OpenDeploy aims to do: the whole thing, done by AI.**

## Demo

<p align="center">
  <img src="./assets/wizard.gif" alt="OpenDeploy initial setup" width="720" />
  <br/><sub>Initial setup — configure your LLM provider</sub>
</p>

<p align="center">
  <img src="./assets/project.gif" alt="OpenDeploy create a project" width="720" />
  <br/><sub>Create a project — connect to Kingdee Cloud Cosmic V9</sub>
</p>

<p align="center">
  <img src="./assets/skills.gif" alt="OpenDeploy skills knowledge base" width="720" />
  <br/><sub>Skills knowledge base — implementation methodology and BOS references loaded on demand</sub>
</p>

<p align="center">
  <img src="./assets/case.gif" alt="OpenDeploy real customization" width="720" />
  <br/><sub>Real customization end-to-end — business request to applied BOS extension</sub>
</p>

## Features

**LLM providers** (BYO API key): Claude · GPT · DeepSeek · Qwen · GLM · Kimi · Doubao · Hunyuan · MiniMax · Baichuan · Ollama (local)

**Kingdee Cloud Cosmic V9 customization** (BOS HTTP RPC end-to-end — never touches your database):

- **Create new metaobjects via BOS template inheritance** — 27 templates across 4 ModelTypes (BillForm / BaseDataForm / SysReport / DynamicForm), wire-equivalent to BOS Designer's "New Wizard → Template Inheritance" (**new in v0.2**)
- **SysReport (账表) filter parameters + columns config** — program-equivalent to BOS Designer "过滤参数面板" + "报表模板 → 列设置", end-to-end from `create_from_template` to runnable report (**new in v0.2.2**)
- Extension lifecycle — create / delete / list
- Fields — 12 types (text / number / amount / quantity / date / checkbox / combo / base-data / mnemonic / unit / formula / property-binding)
- Entry body — EntryEntity / TabPage / TabControl: create / delete / rename
- Python plugins — form plugins (30+ events), list plugins, operation service plugins, SysReport service plugins
- Business rules — Calculate / GetInvStock / ...
- Custom operations + toolbar buttons + list-menu buttons
- Convert rules — generalized to any source/target pair, with extension + convert plugins
- Property grid — required / default value / row-number / org-field binding / entity required

**Knowledge base** (11 skills / 67 markdown files / 14,933 lines, pulled from GitHub with Gitee mirror fallback): implementation methodology + customization decision trees + BOS element references + customer-validated case studies

**Architecture**: zero self-hosted servers · credentials stay local (plaintext in `settings.json`, never reaches the renderer process) · single-consultant local tool

## Getting started

Requires Windows 10/11 + an LLM API key.

**Download the installer (recommended)**

[**👉 v0.2.8-alpha installer**](https://github.com/qiaolei227/opendeploy/releases/latest) — grab `OpenDeploy-*-x64-setup.exe` and double-click to install.

**Local development**

```bash
pnpm install
pnpm dev
```

## Status

**v0.2.8-alpha released** — Upstream sync + streaming tool-call completeness. This release merges qiaolei227/opendeploy's 10-24 batch: (1) Claude streamed tool calls are now buffered per turn and replayed with their history — a truncated or malformed call drops the whole turn instead of executing half a call; (2) BOS login no longer infers “password expired” from `CheckPasswordPolicy`, the server's own message is preserved and bad credentials still stay disconnected (issue #13); (3) queued tools are skipped after cancellation while keeping tool_use/tool_result pairing intact for replay; (4) knowledge manifests are byte-reproducible across platforms (`.gitattributes` pins LF, the generator rejects CRLF), with the runtime hash normalization kept as a safety net for Windows checkouts. 83 test files / 994 tests green, typecheck + lint clean. Internal preview for BOS customization consultants; features / API / UX may still change.

- Target: Kingdee Cloud Cosmic V9 on-premise (Standard / Enterprise editions; V8 not supported — login protocol differs)
- Platform: Windows x64 only (macOS / Linux pending user feedback)
- 11 skills / 69 markdown files / 15,310 lines of industry knowledge
- 919 unit / wire-replay tests, lint clean, real-server smoke + agent-loop e2e covered

## License

MIT — see [LICENSE](./LICENSE)
