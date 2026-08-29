---
name: python-plugin-index
title: K/3 Cloud Python 插件开发索引
description: 写 K/3 Cloud IronPython 2.7 表单插件(BeforeSave 拦截 / 字段联动 / 按钮点击 / DataChanged)或列表插件(AfterBarItemClick / ListRowDoubleClick / FormatCellValue)时加载。本 skill 本身是索引,告诉你有哪些子文件可拉,遇到具体问题按需用 load_skill_file 拉详细的事件签名 / API 表 / 模板 / 异常处理姿势。Agent 准备生成 pyBody 传给 k3cloud_register_python_plugins / k3cloud_register_list_python_plugins 前先加载它。用户说"在 BOS 设计器/协同开发平台注册了 Python 脚本但保存不报错、运行不生效/不弹窗/静默失败"时也必须加载——那是另一条注册路径,代码是函数形式(this.View)而非类形式(self.View),差异见 references/known-pitfalls。
version: 1.0.0
category: plugin-dev
---

# K/3 Cloud Python 插件开发索引

本 skill 覆盖四类 K/3 Cloud Python 插件:

| 类型 | wire 节点 | 基类 | 注册工具 | 触发时机 |
|---|---|---|---|---|
| **表单插件** | `<Form><FormPlugins>` | `AbstractBillPlugIn` / `AbstractDynamicFormPlugIn` | `k3cloud_register_python_plugins` | 用户进入**单据录入页**(新建/查看/修改单据) |
| **列表插件**(Plan 7.2) | `<Form><ListPlugins>` | `AbstractListPlugIn` | `k3cloud_register_list_python_plugins` | 用户进入**列表页**(查列表/双击行/列表工具栏点按钮) |
| **操作服务插件**(Plan 7.3) | `<FormOperation><ServicePlugins>` | `AbstractOperationServicePlugIn`(Python 走 `PythonOperationServicePlugIn`) | `k3cloud_add_custom_operation(pyBody=..., pluginClassName=...)` inline | 用户点**该具体操作按钮**(操作绑定 service plugin,跟单据生命周期解耦) |
| **账表插件**(Plan 7.6 解锁) | `<Form><SysReportServicePlugins>` (action="edit" 模式) | `AbstractSysReportPlugIn` + `AbstractSysReportServicePlugIn`(Python 走 `PythonReportPlugIn`) | `k3cloud_create_from_template`(账表对象创建) + `k3cloud_register_sysreport_python_plugins` | 用户进入**账表页**(报表查询 / 单元格点击 / SQL 构造) |

前两类挂在父对象 Form 下,操作服务插件挂在具体某个 FormOperation 内 — 跟着操作 key 走,只在那个操作触发时执行。账表插件挂在 SysReport 元数据对象的 `<SysReportServicePlugins>` 节点(v0.2 起可全自动完成)。

客户实战频次:`AfterBindData`(表单 49 处)/ `AfterBarItemClick`(列表 17 + 表单 32 处)/ `OnPreparePropertys`(操作服务 36 处)分别是三类的最高频事件。

其他插件类型(转换插件、打印插件、报表插件)OpenDeploy **不自动化**——如果用户需要这些,查 `k3cloud/bos-features-index` 的 `references/plugin-types` 知道全谱,告知用户手工在 BOS Designer 注册。

## 运行环境速览

- **IronPython 2.7**(2014 年冻结),`.NET Framework` 之上跑
- Python 3 语法**不能用**:没有 `print()` 函数强制、没有 `f"..."`、`dict.items()` 返回 list
- 所有 .NET 类型原生可用:`System.String`, `System.DateTime`, `System.Exception`
- K/3 Cloud 特有类型通过 `clr.AddReference("Kingdee.BOS")` 等引入

## 最小模板

**表单插件**:
```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn
from Kingdee.BOS.Core.DynamicForm.PlugIn.Args import *
from Kingdee.BOS import KDException

class MyPlugIn(AbstractBillPlugIn):
    # 事件 override 方法写这里
    pass
```

**列表插件**(Plan 7.2):
```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.List.PlugIn import AbstractListPlugIn
from Kingdee.BOS.Core.List.PlugIn.Args import *
from Kingdee.BOS import KDException

class MyListPlugIn(AbstractListPlugIn):
    # 列表事件 override 方法写这里(如 AfterBarItemClick / ListRowDoubleClick)
    pass
```

**操作服务插件**(Plan 7.3):
```python
import clr
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')
from Kingdee.BOS.Core.DynamicForm.PlugIn import AbstractOperationServicePlugIn
from Kingdee.BOS.Core.DynamicForm.PlugIn.Args import *
from Kingdee.BOS import KDException

class MyOpServicePlugIn(AbstractOperationServicePlugIn):
    # 操作生命周期 override(如 OnPreparePropertys / BeginOperationTransaction)
    pass
```

**关键**:`class MyPlugIn` 的类名**不影响注册**——注册在 `FKERNELXML` 的 `<ClassName>` 元素里,是 OpenDeploy 工具的 `className` 参数。脚本里的类名只供可读。挂错位置(列表事件写到表单插件 / 表单事件写到列表插件)**不触发**:确保事件名在所选基类的 events-reference 段落里出现。

> ⚠️ **以上类形式只适用于 OpenDeploy 工具注册路径。**
> 用户若在 **BOS 设计器 / 协同开发平台里右键"注册Python脚本"**,那是另一条路:
> 代码必须是**函数形式** —— `def AfterBindData(e):` 配 `this.View`,**不写 class、不用 self**。
> 写成 `class X(AbstractBillPlugIn)` 时保存不报错,但类从不被实例化,**代码永不执行**(连 `raise Exception` 都没反应)。
> 生成 pyBody 前先问清用户走哪条路;已踩坑的完整对照见 `references/known-pitfalls` §0-§2。

### 默认写法:函数形式 + `AfterBindData`(项目约定)

**除非用户明确说"用 OpenDeploy 工具注册",一律按下面的形式给代码**——本项目使用者在真实环境里
走的是 BOS 设计器手工注册路径,类形式的代码给出去就是不生效的。

```python
import clr
clr.AddReference('System')
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')

from System import *
from Kingdee.BOS.Core import *

def AfterBindData(e):
    # 逻辑写这里,用 this.View / this.Model / this.Context
    pass
```

三条配套约定:
1. **事件默认 `AfterBindData`** —— `OnLoad` 时控件未完成绑定,`ShowMessage` / 控件属性设置可能被吞;
   只有确实需要在数据绑定前介入(如改元数据)才用更早的事件。
2. **判断新增用 `this.View.OpenParameter.Status`** —— `0=新增 / 1=查看 / 2=修改`,
   不要用 `Model.OperationStatus`(Flags 枚举,`==` 比较会漏)。
3. **不要 import `OperationStatus`** —— IronPython 下该 import 路径取不到(实测 `Cannot import name`)。

## 子文件导航(按需 load_skill_file)

按你当前要解决的子主题拉对应文件,**不要一次性全拉**——每份 200-400 行,全拉会挤满上下文。

### 过程性指引(prompts/)

| 何时拉 | path 传给 `load_skill_file` |
|---|---|
| 写了 `BeforeSave` 类的校验,不确定 `e.Cancel` 和 `KDException` 怎么配合 | `prompts/error-handling` |
| 注册了插件但没触发,或抛异常 UI 没反应 | `prompts/debugging` |

### 查阅资料(references/)

| 何时拉 | path 传给 `load_skill_file` |
|---|---|
| 要 override 事件,但不知道事件全谱和签名 | `references/events-reference` |
| 写 `self.Model.GetValue(...)` 忘了基础资料字段怎么取 / `self.View` / `self.Context` API 的形状 | `references/model-api` |
| 拿到一个典型场景(保存前校验 / 字段联动 / 按钮触发),想照着模板改 | `references/templates` |
| 手工在 BOS 设计器注册的插件不生效 / 不弹窗 / 静默失败(连 raise 都没反应) | `references/known-pitfalls` |

## 使用原则

1. **先把 `solution-decision-framework` 的 3 个澄清问答了再写**——"触发时机"决定你选哪个事件,"异常处理"决定姿势,"数据来源"决定复杂度
2. **不要假定用户装了反编译工具**(`ilspycmd`)——本 skill 的 API 签名是手整理的覆盖 80% 场景,精确签名以用户本地 DLL 为准。签名对不上时告诉用户"以你机器 `D:\K3Cloud\WebSite\Bin\Kingdee.BOS.Core.dll` 为准",不要强求反编译
3. **IronPython 缩进严格**,统一 4 空格,**不要混 Tab**
4. **中文字符串前加 `u` 前缀**:`u"客户必须填写"`,否则某些 .NET 路径会乱码
5. **判空用 `is None`**,不要用 `if not val:`——`0` / `""` / `0.0` 都是 falsy 但不是 None

## 工具触发点

写完 `pyBody` 后的调用链:

```
k3cloud_list_extensions         # 查父单据有无现成扩展可复用
  ├─ 有 → k3cloud_register_python_plugins        (表单插件)
  │      或 k3cloud_register_list_python_plugins (列表插件,Plan 7.2)
  │      或 k3cloud_add_custom_operation(pyBody=..., pluginClassName=...) (操作服务插件 inline,Plan 7.3)
  └─ 无 → k3cloud_create_extension(建新扩展) → 注册工具同上
```

账表插件(新增 v0.2):

```
1. k3cloud_create_from_template(templateId='BOS_SimpleSysReport', ...)  # 创建新账表对象(或挂在已有原厂账表的扩展上)
2. k3cloud_register_sysreport_python_plugins(formId, className, pyBody)  # 挂 Python 服务插件
```

四类插件选哪个看用户需求:
- **用户在单据录入页要触发的逻辑** → 表单插件
- **用户在列表页要触发的逻辑**(典型:列表自定义按钮、列表双击行) → 列表插件
- **新建一个自定义操作 + 一段 inline 逻辑**(操作和逻辑紧绑) → 操作服务插件
- **自定义报表 / 账表查询逻辑**(SQL 构造 / 数据展示) → 账表插件

**特别注意:内置操作(Audit / UnAudit / Delete / Submit)的拦截** 推荐走**表单插件**的 `BeforeDoOperation(self, e)` 事件 + 判 `e.Operation.OperationName == "UnAudit"` 等,设 `e.Cancel = True`。比操作服务插件路径轻量、UI 弹窗友好,客户实战最常见。详见 events-reference 的"审核 / 反审核 / 弃审拦截"段。

挂错位置插件**不触发**(form 事件挂到 list 不跑;表单插件的事件挂到列表插件类继承下来不被识别)。

### 典型联动:**列表按钮 + 列表插件**

客户最常见的列表二开需求是"在列表上加自定义按钮触发批量逻辑"(memory `reference_customer_k3_plugin_projects` 实战:`AfterBarItemClick` 17 处)。完整步骤:

```
1. k3cloud_add_custom_operation         # 创建自定义操作 (operationId=45,挂 servicePlugin 可选)
2. k3cloud_add_toolbar_button           # target.kind='list' 挂列表菜单
   └─ target: { kind: 'list' }
3. k3cloud_register_list_python_plugins # 写 AfterBarItemClick 实现按钮行为
   └─ 内部判 e.BarItemKey 分发到具体逻辑
```

`target.kind` 选错(挂到 form 顶层菜单),客户在列表页看不到按钮 —— 不报错但功能等同没生效。

两条路之后都要**提醒用户**:BOS Designer F5 刷新 / 客户端重登测试。OpenDeploy 不自动刷缓存。
