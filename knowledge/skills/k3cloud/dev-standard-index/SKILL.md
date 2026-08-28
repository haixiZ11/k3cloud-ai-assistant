---
name: dev-standard-index
title: 金蝶云星空二次开发规范索引
description: 给自定义元素命名之前(业务对象 Key / 字段标识 / 控件标识 / 表字段)、生成或评审 C# 插件代码之前、用户问"金蝶有什么开发规范 / 这么做合不合规"、以及部署上线话题(质量分 / 环境 / 协同开发云要求)时加载。本 skill 是金蝶官方《金蝶云星空二次开发规范》的结构化索引——定制开发管理规范 / 业务对象开发规范 / 代码编写规范(含禁用代码清单) / 脚本编写规范 / API 开发规范,并给出每条规范与 OpenDeploy 工具链的对照。
version: 1.0.0
category: metadata
---

<!-- 来源:https://open.kingdee.com/k3cloud/open/DevelopStandard.html(fetched 2026-08-28,现行版本);实证状态:🟡 主流程(官方条文,未在客户环境逐条实测执行口径) -->

# 金蝶云星空二次开发规范索引 🟡

## 何时加载本 skill

触发条件(agent 按需 `load_skill('k3cloud/dev-standard-index')`):

1. **要命名任何自定义元素之前**——业务对象 Key、字段标识、物理字段名、标签/页签/面板等控件标识、自定义表和字段。命名不规范 = 质量门禁扣分 + 多安装包场景冲突。
2. **要生成或评审 C# / DLL 插件代码之前**——官方有明确的"禁止使用的代码"清单(进程 / 文件 IO / Socket / 管理中心 API / UnSafe),质量扫描会卡,生成的源码必须从源头避开。
3. **用户问"金蝶有什么开发规范 / 要求 / 这么做行不行"**——引用本 skill 对应 reference,给条文 + 判断。
4. **部署上线话题**——质量分 ≥70 才能进测试部署、四套环境、协同开发云强制令、kdpkg 制品库。

## 规范一句话总览

| 部分 | 管什么 | 子文件 |
|---|---|---|
| 定制开发管理规范 | 人(岗位)、平台(协同开发云强制)、过程(五阶段)、质量门禁(≥70 分)、环境(DEV/SIT/UAT/PRO)、源码托管(SVN,禁 GitHub) | `references/management-cdp.md` |
| 业务对象开发规范 | 业务对象 Key / 字段 / 控件的命名 + 元数据设计(平级扩展禁令、字段数、布局、网控、主键) | `references/naming-and-metadata.md` |
| 代码编写规范 | 工程/类命名 + **禁止使用的代码清单** + 性能设计红线 | `references/code-and-script-rules.md` |
| 脚本编写规范 | KSQL、DDL(表/字段/主键/类型)、DML(参数化 / join 上限 / 批量上限) | `references/code-and-script-rules.md` |
| API 开发规范 | 第三方登录授权、秘钥安全、标准 SDK | `references/management-cdp.md`(细看 `k3cloud/webapi-index`) |

## 与 OpenDeploy 的关系

**已对齐(工具已内置等价约束)**:

- 官方"不允许对一个业务对象做多个平级扩展" ↔ OpenDeploy 的"单层树规则"硬约束(每个父对象顶多挂 1 个本项目 devCode 的扩展,见 `k3cloud_create_extension` 的 list_extensions 前检)
- 官方"开发成果统一走协同开发云在线构建" ↔ 决定 OpenDeploy 的 DLL/C# 路线:生成源码 → 用户在协同开发云插件工程里签入 → 平台构建部署(见 `k3cloud/dll-plugin-index`)

**规范里有、OpenDeploy 还没管的(贡献方向,不是当前工具的缺陷)**:

- 自定义元素命名 `{ISV}_xxx` 前缀校验——agent 生成字段/控件时应主动带上项目 devCode 前缀,并在话术里提示规范依据
- C# 禁用代码清单——未来做 C# 插件生成时,这是校验器(validator)的需求清单
- 单据字段总数 ≤50、网控必须配置——agent 设计大方案时应自查提醒

## 典型误判

1. **"字段标识随便起,能用就行"**——错。官方要求扩展字段标识和属性必须以开发商代码加下划线排头(如 `PAAB_xxxxx`),物理字段名 `F_PAAB_xxxxx`。乱起名在多 ISV / 多安装包环境会冲突,且过不了质量门禁。
2. **"DLL 编译过就能部署"**——错。代码要过协同开发云质量检测(SQL 脚本 / 第三方资源 / 业务对象 / 插件代码四维度),"严重"和"阻断"问题必须修复且总分 ≥70,安装包才能进测试部署。
3. **"私有云可以随便找个环境改"**——错(管理层面)。规范要求四套环境且版本补丁一致,UAT 过了的补丁才能上 PRO;开发必须在协同开发云做,集成开发平台只对特殊客户申请延用。
4. **"源码放 GitHub 方便协作"**——违规。定制开发源码不允许上传 GitHub 等开源平台,必须用协同开发云应用源码服务(SVN)。

## 子文件导航

按需加载(不要一次全拉):

| 子文件 | 何时加载 |
|---|---|
| `references/management-cdp.md` | 部署 / 上线 / 质量分 / 协同开发云流程 / "要不要用集成开发平台"类问题 |
| `references/naming-and-metadata.md` | 命名任何自定义元素之前;业务对象元数据设计审查 |
| `references/code-and-script-rules.md` | 生成 / 评审 C# 插件代码之前(禁用代码清单);涉及自定义表 / SQL 脚本时 |

调用方式:`load_skill_file('k3cloud/dev-standard-index', 'references/naming-and-metadata')`

## 临时话术(agent 引用)

> 金蝶官方有《金蝶云星空二次开发规范》,对定制开发的命名、元数据设计、插件代码、SQL 脚本、部署流程都有硬性要求。跟当前这件事直接相关的有三条:
> 1.(按场景引用对应 reference 条文)
> 2. ……
> 3. ……
>
> OpenDeploy 在【已对齐项】上已经帮你保证了;【未对齐项】需要你在设计时注意,我会在方案里按规范命名 / 标注。
