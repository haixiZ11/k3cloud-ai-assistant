# Python 插件已知坑(实证)

实证环境除特别说明外均为 **K/3 Cloud 9.1.861.11 + 协同开发平台 + 销售订单(SAL_SaleOrder)**,
由使用者在本机客户端(`K3CloudClient` / `K3CloudClientX86`)实际打开单据验证,非文档推断。

> 本文件只记录**手工在 BOS 设计器 / 协同开发平台注册**这条路径的坑。
> OpenDeploy 工具注册(`k3cloud_register_python_plugins`)走的是完全不同的机制,见 §1 的路径对照。

---

## 0. 两条注册路径的代码形态完全不同(2026-08-29 实证 🟢)

这是本次踩坑的总根因,先分清你走哪条路再谈其他。

| | 路径 A:OpenDeploy 工具注册 | 路径 B:BOS 设计器"注册Python脚本" |
|---|---|---|
| 注册位置 | `FKERNELXML` 的 `<ClassName>` 元素 | 表单属性 → 插件配置 → 右键"注册Python脚本" |
| 代码形态 | **类形式** `class X(AbstractBillPlugIn)` | **函数形式** `def AfterBindData(e):` |
| 上下文变量 | `self.View` / `self.Model` | `this.View` / `this.Model` |
| 类名作用 | 由工具 `className` 参数决定,脚本内类名仅供参考 | 没有类,脚本是一组事件函数 |
| 文档出处 | 本 skill 的 SKILL.md / templates | 本文件 |

**路径 B 里写类形式,保存时不报任何错,但代码永远不执行**——因为系统把整个脚本当成"事件函数集合"解析,
你的 `class` 只是个普通 Python 类定义,从未被实例化,`def OnLoad(self, e)` 也就不可能被当作事件回调。

> ⚠️ **这是路径差异,不是版本变更 —— 别误判成"新版本取消了类式写法"。**
> 实证(2026-08-29,9.1.861.11):客户端 `K3CloudClient` 与 `K3CloudClientX86` 目录下 **IronPython.dll 都在**,
> Python 引擎完好;同环境下函数式脚本正常执行并弹出 `ADDNEW`,说明 9.1 的 Python 链路完全正常。
> 官方开放平台 SDK 中 `AbstractBillPlugIn` 类仍在,未移除。
> 函数式 + `this` 是**路径 B 自早期版本(至少 2024 年 V8 时代)以来的固有形态** ——
> 2024-12 与 2025-04 两篇社区实战文的 Python 示例全是 `def BarItemClick(e):` / `this.View`,无一例类形式。
> 因此:遇到"类式不执行",先查注册路径,**不要建议用户改用 C# 或归咎于版本升级**。

---

## 1. 类形式代码在"注册Python脚本"下静默不执行(2026-08-29 实证 🟢)

### 症状

脚本写成下面这样,BOS 设计器保存通过、无语法报错,插件启用已勾选,但打开单据毫无反应。
**连 `raise Exception` 都不会弹错误框**。

```python
from Kingdee.BOS.Core.Bill.PlugIn import AbstractBillPlugIn

class new_showtime(AbstractBillPlugIn):
    def OnLoad(self, e):
        self.View.ShowMessage(u"当前时间：")
```

### 根因

路径 B(见 §0)不认识类形式。系统加载脚本后按名字去找 `OnLoad` 这样的**顶层函数**,
找不到就当这个事件没实现,静默跳过。没有日志、没有报错,是最难自查的一种失败。

### 对策

删掉 `class` 和 `self`,改写成顶层函数 + `this`:

```python
import clr
clr.AddReference('System')
clr.AddReference('Kingdee.BOS')
clr.AddReference('Kingdee.BOS.Core')

from System import *
from Kingdee.BOS.Core import *

def AfterBindData(e):
    if int(this.View.OpenParameter.Status) == 0:
        this.View.ShowMessage(u"当前时间：" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"))
```

### 影响范围

本 skill 的 `SKILL.md` 最小模板和 `references/templates.md` 全是路径 A 的类形式。
用户如果是手工注册,生成代码前必须先问清注册方式,否则给出去的模板一定不生效。

---

## 2. `raise Exception` 是判断"插件有没有被加载"的最快二分法(2026-08-29 实证 🟢)

### 症状

不确定插件是"没加载"还是"加载了但逻辑没命中",在类形式下反复改判断条件浪费时间。

### 根因

类形式在路径 B 下根本不执行,任何条件判断都是在错误的分支上排查。

### 对策

先用最粗暴的方式二分:

```python
def AfterBindData(e):
    raise Exception(u"插件已执行")
```

- **弹出错误框** → 插件已加载,问题在业务逻辑或事件选择,继续往下查
- **毫无反应** → 插件没加载,回到 §0 / §1 查注册路径和代码形态,不要再看业务代码

### 影响范围

`prompts/debugging.md` §2 的"塞 ShowMessage"思路对路径 B 同样适用,但示例是类形式(`def BeforeSave(self, e)`),
路径 B 下要写成 `def BeforeSave(e):`。

---

## 3. 判断"新增"用 `OpenParameter.Status`,不要用 `OperationStatus`(2026-08-29 实证 🟢)

### 症状

`if self.View.Model.OperationStatus == OperationStatus.ADD:` 永远不成立,或时灵时不灵。

### 根因

`OperationStatus` 是带 `[Flags]` 的枚举,实际值可能是 `ADD|OPEN` 这种组合态,用 `==` 严格比较必然漏。
另外单据打开流程是"先以 OPEN 加载,再切进新增态",`OnLoad` 时机拿到的也常不是 `ADD`。

### 对策

用 `this.View.OpenParameter.Status`,它返回的是界面状态,语义稳定:

```python
# 0 = 新增(ADDNEW),1 = 查看,2 = 修改
if int(this.View.OpenParameter.Status) == 0:
    ...
```

调试时把它打出来看真实值:`this.View.ShowMessage(u"状态=" + str(this.View.OpenParameter.Status))`,
9.1 环境新增态实测输出 `ADDNEW`。

### 影响范围

`references/events-reference.md` 里凡是涉及"新增/修改/查看"分支判断的示例都要用这个写法。

---

## 4. `OnLoad` 里的 `ShowMessage` 会被吞,改 `AfterBindData`(2026-08-29 实证 🟢)

### 症状

弹窗代码写在 `OnLoad` 里,插件确实执行了(用 `raise` 验证过),但消息框不出现。

### 根因

表单插件是 Web 服务层插件,`OnLoad` 时界面控件还没完成数据绑定,
此时推送的 `ShowMessage` 到客户端后可能被后续渲染流程覆盖掉。

### 对策

弹窗一律放到 `AfterBindData`(数据绑定完成后触发)。事件顺序参考
`prompts/debugging.md` 与 `references/events-reference.md`:`OnLoad` → `BeforeBindData` → `AfterBindData`。

### 影响范围

所有"打开单据就提示"类需求的默认事件从 `OnLoad` 改为 `AfterBindData`。

---

## 5. 协同开发平台:只保存不签入,服务器拿不到新脚本(2026-08-29 实证 🟢)

### 症状

改完脚本、保存成功,客户端重开单据仍是旧行为。

### 根因

协同开发平台模式下"保存"只写入本地工作区,必须**签入**才提交到服务器。
插件配置行前的 `*` 标记就是"本地已改、未签入"的信号。

### 对策

1. 点**保存全部**
2. 点**签入**,确认修改行的 `*` 消失
3. 如有发布按钮,再执行**发布**

### 影响范围

`prompts/debugging.md` §6 的缓存段只提了 F5 / 重登,没覆盖协同开发平台的签入环节,需补。

---

## 6. 客户端按"已打开的单据页签"缓存脚本,必须关页签重开(2026-08-29 实证 🟢)

### 症状

签入也做了、客户端也重开了,打开单据还是旧行为。

### 根因

客户端对 Python 脚本的缓存粒度是**已打开的单据页签**。
重开整个客户端或刷新页面都不一定重新编译脚本,只有把页签点 X 关掉、从菜单重新进入才会重新加载。

### 对策

1. 把当前打开的所有单据页签**点 X 关掉**
2. 从菜单重新进入,打开一张新单据
3. 仍不生效再清缓存目录:`%APPDATA%\Kingdee` 与客户端安装目录下的 `Cache`

### 影响范围

`prompts/debugging.md` §6 的"重登客户端"建议应细化为"先关页签重开,再考虑重登/清缓存"。

---

## 7. `OperationStatus` 的 import 路径在 Python 里对不上(2026-08-29 实证 🟢)

### 症状

`from Kingdee.BOS.Core.Metadata.Operation import OperationStatus` 报 `Cannot import name OperationStatus`。

### 根因

IronPython 的 import 路径与 C# 的 `using` 命名空间不总是一一对应,
`OperationStatus` 在脚本式注册下按这个路径取不到。

### 对策

路径 B 下不要 import 这个枚举,直接用 `this.View.OpenParameter.Status`(见 §3)。
如果确实需要枚举本身,试 `import Kingdee.BOS.Core.Metadata.Operation` 后用全名访问,
但不同补丁号可能差一级,不如整数比较稳。

### 影响范围

`references/events-reference.md` 中如引用了 `OperationStatus` 的 import 示例需复核。
