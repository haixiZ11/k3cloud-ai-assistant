<!--
来源:https://open.kingdee.com/k3cloud/open/DevelopStandard.html(fetched 2026-08-28,现行版本);实证状态:🟡 主流程(官方条文,未在客户环境逐条实测;质量扫描的具体检测实现未见过)
交叉引用:k3cloud/dll-plugin-index/references/development-setup.md(VS 工程搭建)、k3cloud/python-plugin-index(Python 插件)
-->

# 代码编写规范(含禁用代码清单)+ 脚本编写规范 🟡

> 生成 / 评审 C# 插件代码之前,以及涉及自定义表、SQL 脚本时必读。**禁用代码清单是协同开发云质量扫描的硬红线**——"严重 / 阻断"问题不修复,构建出的安装包不允许进测试部署(总分还要 ≥70)。

---

## 1. 代码编写规范 · 命名

| 层 | 规则 | 示例 |
|---|---|---|
| 工程名 | `{开发商标识}.{项目}.{工程归类}` | `PPAB.K3Cloud.PrintingSystem.csproj` |
| 工程名(细分模块) | `{开发商标识}.{项目}.{工程归类}.{模块名}`(四级命名空间) | `PPAB.K3Cloud.PrintingSystem.ProductionOrder.csproj` |
| 命名空间 | **必须与工程名、生成的程序集名称一致** | 同上 |
| 命名风格 | 大驼峰;除分隔的 `.` 外仅允许 26 个大小写英文字母 + 辅助数字 | |
| 表单插件类 | `{命名空间}.XxxxxBusinessPlugIn` | `PPAB.K3Cloud.PrintingSystem.SaleOrderBusinessPlugIn.cs` |
| 服务操作插件类 | `{命名空间}.XxxxxServicePlugIn` | `PPAB.K3Cloud.PrintingSystem.SaleOrderServicePlugIn.cs` |
| 其他类 / 方法 / 变量 | 大驼峰 / 小驼峰 | |

与 `dll-plugin-index/references/development-setup.md` 第 1 节一致,以官方规范为准绳。

## 2. 禁止使用的代码(质量扫描硬红线)

> 官方原文:"禁止所有一切可能危害服务器运行安全的代码,代码标准平台会动态调整"。下表为现行清单——**未来 OpenDeploy 生成 C# 插件时,这就是校验器的规则集**。

| 类别 | 禁止示例 | 原因 |
|---|---|---|
| 进程 | `Process`、`ProcessStartInfo`、`System.Diagnostics` | 插件跑在服务端 IIS 进程里,起子进程是安全红线 |
| 读 OS 用户信息 | `ProductEnvironmentService`、`IEnvironmentDetectService`、`EnvironmentDetect`、`ProductEnvironment`、`Environment` | 泄露服务器环境信息 |
| 本地文件操作 | `System.IO`、`FileStream`、`StreamWriter`、`TextWriter`、`BufferedStream`、`MemoryStream`、`BinaryWriter`、`File.Create`、`Directory.CreateDirectory` | 平台规定临时目录除外;插件应走 K/3 的存储服务而不是自己摸文件系统 |
| Socket 侦听 | `Socket`、`System.Net.Sockets`、`SocketAsyncEventArgs`、`SocketServiceManager`、`SocketClientManager` | 服务端不允许开监听端口 |
| 管理中心接口 | `GetManagementDataCenterContext`、`Kingdee.BOS.MC.ServiceHelper`、`Kingdee.BOS.MC`、`Kingdee.BOS.MC.App`、`Kingdee.BOS.MC.ServiceFacade` | 管理中心(账套管理)是 BOS 禁用调用域 |
| UnSafe | 任何 `unsafe` 代码 | |

**agent 行为约定**:

1. 生成 C# 插件源码时,逐条对照此表;调外部 HTTP 服务用 `HttpWebRequest` / `HttpClient` 这类**出站**请求(监听才是禁的),文件落地走平台服务或临时目录约定。
2. 用户贴来一段已有 DLL 代码问"能不能用",先扫这张表,命中就明确告知"这段过不了协同开发云质量扫描的阻断项,要改"。
3. 注意"平台会动态调整"——这张表是 2026-08 快照,以官方页为准。

## 3. 代码设计规范

- **禁止在大批量循环中执行低性能或高数据量 SQL**——批量场景用集合一次性处理(参见 `python-vs-dll.md` 场景 D 的批量审核示例)。
- SQL 脚本一律走 KSQL 规范(见下)。

## 4. 脚本编写规范 · DDL(自定义表 / 视图)

| 条文 | 内容 |
|---|---|
| 表名 / 视图名 | `{ISV标识符}_T_{名称}`,如 `ABC_T_USER` |
| 字段名 | `F_{ISV标识符}_{名称}`,如 `F_ABC_USERNAME` |
| 主键 | 必须有物理主键 + 聚集索引;**原则上整型(不允许自增长)**;小数据量表可用字符型 |
| 禁改标准视图 | |
| 禁删物理表 | 临时表除外 |
| **禁触发器** | |
| 存储过程 | 不建议使用 |
| 索引字段值 | 不允许 NULL;GUID 字段不允许建聚集索引 |
| 主从表 | 从表外键字段名与主表一致,外键建非聚集索引 |
| 数量 / 金额 | 必须精确数值类型 `Decimal`,禁止 `Double` / `Float` / `Money`;固定精度 `Decimal(23,10)` / `Decimal(19,6)`,禁止为空,默认值 0 |
| 字符 | 统一 `nvarchar` |
| NULL 字段 | Not null 字段必须设缺省值 |
| 多语言 | 单独放一张表,外键建非聚集索引 |
| text | 用 `ntext` 替代 `text` |
| 临时表 | 显式创建,用完显式删除 |

## 5. 脚本编写规范 · DML

| 条文 | 内容 |
|---|---|
| 查询条件 | 任何查询都要带条件;**必须参数化查询** |
| 事务 | 保持简短,处于一个批处理;查询类用低隔离级别提高并发 |
| 连接 | **必须 join,禁止 where 条件连接**;join 表数量 ≤10 |
| 预置数据 | insert 前必须按主键匹配删除再插入 |
| 批量 | 一次批量提交 ≤500 条,超过分批 |
| 视图 | 能关联物理表的不要关联视图 |
| 旧外连接 | 禁用 `*=` / `=*` |
| where 优化 | `=` 左边不做函数 / 算术;不用函数(吃不了索引);用明确类型值避免隐式转换;不用 case;连续数值用 `between` 替代 `in`;`in` 超 30 个值用表函数;**禁 `fid in (select ...)` 必须改 `exists(select 1 ... where v.fid = fid)`** |
| ORDER BY | 字段别名禁止用表别名做前缀(SQL Server 2005 会执行中断) |

KSQL 具体规范见官方《金蝶KSQL规范》(本 skill 不收录,按需查)。

**OpenDeploy 视角**:agent 当前不生成 DDL/DML 脚本;一旦涉及"帮用户写个初始化 SQL / 自定义表脚本"的需求,本节就是输出前的自查清单,并提示用户脚本会进质量扫描。

---

## agent 话术模板

### 场景:用户贴来一段 C# 插件代码问"这个能不能直接用"

> 我按金蝶二开规范的禁用代码清单扫了一遍:你这段在 `xxx` 用到了【Process / FileStream / …】,这是质量扫描的阻断项——协同开发云构建会直接卡住,安装包出不来。改法是【平台替代方案】。其他部分(命名 / 事件挂接)没问题。
