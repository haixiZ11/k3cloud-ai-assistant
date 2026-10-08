/**
 * BOS RPC 登录诊断(升级后连不上专用)。
 *
 * 金蝶升级后"账号密码错误"是个大箩筐报错——acctId 变化 / 密码加密路径
 * 变化 / 本地账号通道被协同开发平台收紧 / 账号禁用锁定 / IP 白名单,
 * 全都可能伪装成"账号或密码错误"。这个脚本一次跑出三项关键证据:
 *
 *   1. GetDataCenterList(免认证)→ 核对服务器上真实的账套 ID 是否还等于
 *      项目里配置的 acctId(升级/重建数据中心后 acctId 常变)。
 *   2. GetPublicKeyInfo(免认证)→ 看服务端走 RSA 公钥加密还是"混淆"路径,
 *      与 OpenDeploy 的 cipherPasswordForLogin 分支行为对照。
 *   3. ValidateLoginInfo → 打印原始 LoginResultType / Message / MessageCode,
 *      区分 -1 密码错 / -2 禁用 / -3 锁定 / 其他业务拒绝。
 *
 * Usage:
 *   K3_BASE_URL=http://localhost/k3cloud K3_ACCT_ID=xxx \
 *   K3_USERNAME=admin K3_PASSWORD=xxx \
 *   pnpm tsx scripts/bos-recon/diagnose-login.ts
 *
 * Env:
 *   K3_BASE_URL   default http://localhost/k3cloud
 *   K3_ACCT_ID    default 空 —— 建议先不填,让它列出服务器全部账套再填
 *   K3_USERNAME   必填
 *   K3_PASSWORD   必填
 */

import { getDataCenterList } from '../../src/main/erp/k3cloud/rpc/data-center';
import { login, fetchPublicKeyInfo } from '../../src/main/erp/k3cloud/rpc/login';
import { callKdsvc, parseJsonResponse, applySetCookieToSession, encodeApField, encodeApFieldRaw } from '../../src/main/erp/k3cloud/rpc/http-client';
import { cipherPasswordForLogin, deobfuscatePassword } from '../../src/main/erp/k3cloud/rpc/password';
import { buildClientInfo } from '../../src/main/erp/k3cloud/rpc/clientinfo';

const baseUrl = process.env.K3_BASE_URL ?? 'http://localhost/k3cloud';
const acctId = (process.env.K3_ACCT_ID ?? '').trim();
const username = process.env.K3_USERNAME;
const password = process.env.K3_PASSWORD;

if (!username || !password) {
  console.error('K3_USERNAME and K3_PASSWORD env vars required');
  process.exit(1);
}

console.log('=== BOS RPC 登录诊断 ===');
console.log('baseUrl :', baseUrl);
console.log('acctId  :', acctId || '(未填 —— 将列出服务器全部账套供核对)');
console.log('username:', username);
console.log('password: <hidden, length=' + password.length + '>');
console.log();

// ─── Step 1: GetDataCenterList(免认证)──────────────────────────────
console.log('--- Step 1: GetDataCenterList (免认证, 核对账套 ID) ---');
try {
  const dcs = await getDataCenterList(baseUrl);
  console.log(`服务器返回 ${dcs.length} 个账套:`);
  for (const dc of dcs) {
    const marker = acctId && dc.id === acctId ? '  ← 与配置一致 ✅' : '';
    console.log(`  id=${dc.id}  number=${dc.number}  name=${dc.name}${marker}`);
  }
  if (acctId && !dcs.some((d) => d.id === acctId)) {
    console.log('⚠️ 配置的 acctId 不在服务器账套列表中 —— 升级后账套 ID 可能变了!');
    console.log('   请用上面列出的真实 id 更新项目里的 acctId 再试。');
  }
} catch (e) {
  console.error('GetDataCenterList 失败:', e instanceof Error ? e.message : e);
  console.error('若此步就失败:服务器不可达 / IIS 应用池停 / 非 K3Cloud Web Server。');
  process.exit(1);
}
console.log();

// ─── Step 2: GetPublicKeyInfo ──────────────────────────────────────
// 不依赖 acctId 是否为空:acctId 为空时也发一枪看服务端反应。
const probeAcct = acctId || (await safeFirstAcctId(baseUrl));
if (!probeAcct) {
  console.error('未提供 acctId 且服务器无账套可探测,退出。');
  process.exit(1);
}
console.log(`--- Step 2: GetPublicKeyInfo (acctId=${probeAcct}) ---`);
let obfuscatedKey = '';
try {
  const session = { baseUrl };
  const res = await callKdsvc(session, 'Kingdee.BOS.ServiceFacade.ServicesStub.User.UserService', 'GetPublicKeyInfo', {
    apFields: { ap0: encodeApFieldRaw(probeAcct) },
  });
  applySetCookieToSession(session, res.setCookieHeaders);
  const text = res.bodyText.trim();
  obfuscatedKey = text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
  console.log('原始 bodyText(前 120 字符):', JSON.stringify(text.slice(0, 120)));
  console.log('返回长度:', obfuscatedKey.length);
  if (obfuscatedKey) {
    console.log('非空 → 服务端启用 RSA 公钥加密路径');
    try {
      const cleartextKey = deobfuscatePassword(obfuscatedKey);
      console.log('去混淆后公钥(前 60 字符):', JSON.stringify(cleartextKey.slice(0, 60)));
      console.log('cooked 密码长度:', cipherPasswordForLogin(password!, obfuscatedKey).length);
    } catch (e) {
      console.error('去混淆失败(公钥格式与 OpenDeploy 预期不符?):', e instanceof Error ? e.message : e);
    }
  } else {
    console.log('返回空 → 服务端禁用密码加密,走"混淆"路径(非 RSA)');
    console.log('cooked 密码预览:', JSON.stringify(cipherPasswordForLogin(password!, '')));
  }
} catch (e) {
  console.error('GetPublicKeyInfo 失败:', e instanceof Error ? e.message : e);
  console.error('⚠️ 若 acctId 是空串试出来的失败,可能是账套 ID 已失效。');
}
console.log();

// ─── Step 3: ValidateLoginInfo ─────────────────────────────────────
console.log('--- Step 3: ValidateLoginInfo (真实登录) ---');
try {
  const result = await login({ baseUrl, acctId: probeAcct, username, password });
  console.log('isSuccess  :', result.isSuccess);
  console.log('userId     :', result.userId);
  console.log('userName   :', result.userName);
  console.log('customName :', result.customName);
  console.log('message    :', result.message);
  console.log('messageCode:', result.messageCode);
  console.log('accessToken(prefix):', result.accessToken?.slice(0, 16) + '...');

  // 直接再打一枪原始 JSON,拿到 LoginResultType 数值(login() 只判 ==1)
  const session = { baseUrl };
  await callKdsvc(session, 'Kingdee.BOS.ServiceFacade.ServicesStub.User.UserService', 'GetPublicKeyInfo', {
    apFields: { ap0: encodeApFieldRaw(probeAcct) },
  });
  const loginInfo = {
    AcctID: probeAcct,
    Username: username,
    Password: cipherPasswordForLogin(password!, obfuscatedKey),
    AuthSign: null,
    Lcid: 2052,
    AuthenticateType: 1,
    ValidationCode: null,
    EncyptType: 0,
    LoginType: 0,
    PasswordIsEncrypted: true,
    IpAddress: null,
    ComputerName: null,
    RawSignData: null,
    SignedData: null,
    OpenToken: null,
    ClientInfo: buildClientInfo(),
    EntryRole: null,
    LoginMethod: 0,
    SessionId: null,
    UserToken: null,
    AppId: null,
    AppSecret: null,
    Timestamp: 0,
    RequstIP: null,
    IgnoreVer: false,
    IsShowLoggedInMessage: false,
    IsSameUserToken: false,
    KickoutFlag: 0,
    CustomizationParameter: null,
    OrgNumber: null,
    OriginalClientIP: null,
    SMSCode: null,
    LoginIden: null,
    LoginAgain: null,
  };
  const raw = await callKdsvc(session, 'Kingdee.BOS.ServiceFacade.ServicesStub.User.UserService', 'ValidateLoginInfo', {
    apFields: { ap0: '', ap1: encodeApField(loginInfo) },
  });
  console.log('--- 原始 ValidateLoginInfo 响应 ---');
  console.log(raw.bodyText.slice(0, 800));
  const parsed = parseJsonResponse<{ LoginResultType?: number; Message?: string | null; MessageCode?: string | null }>(raw.bodyText);
  console.log('LoginResultType 数值:', parsed.LoginResultType, '(-1=账号或密码错误 -2=禁用 -3=锁定 1=成功)');
} catch (e) {
  console.error('ValidateLoginInfo 失败(抛出异常,见下):', e instanceof Error ? e.message : e);
}
console.log();

// ─── 结论提示 ───────────────────────────────────────────────────────
console.log('=== 判读指引 ===');
console.log('1. acctId 不在列表 → 升级重建/迁移数据中心导致账套 ID 变化,更新项目配置即可。');
console.log('2. GetPublicKeyInfo 行为与升级前不一致(空↔非空翻转)→ 密码传输路径变了,');
console.log('   需要在 password.ts 调整分支或升级 OpenDeploy 的模拟实现。');
console.log('3. LoginResultType=-1 但密码确认正确 → 强烈怀疑认证通道被收紧');
console.log('   (V8.0+ BOS 设计器登录统一改走协同开发云,老式本地 frmLogin 需"延用申请")');
console.log('   或账号被锁定/IP 白名单。请用金蝶 BOS 设计器/客户端同账号同账套手动登录一次对照。');
console.log('4. -2/-3 → 账号禁用/锁定,找金蝶管理员。');

async function safeFirstAcctId(url: string): Promise<string> {
  try {
    const dcs = await getDataCenterList(url);
    return dcs[0]?.id ?? '';
  } catch {
    return '';
  }
}
