/**
 * Shareable BOS login diagnostic summary. This is NOT an authentication fix.
 *
 * Run: pnpm tsx scripts/bos-recon/diagnose-login.ts
 * K3_BASE_URL is required. With no K3_ACCT_ID, only discover the catalog count;
 * never select the first account automatically. Supply an explicit account ID
 * from the BOS client plus K3_USERNAME / K3_PASSWORD for ONE login attempt.
 * No CAPTCHA retries, raw responses, account names/IDs, URLs, exception text,
 * key material, password lengths/ciphertexts, cookies or token prefixes are
 * printed. The normal RPC log sinks are disabled for this diagnostic session.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDataCenterList } from '../../src/main/erp/k3cloud/rpc/data-center';
import { login } from '../../src/main/erp/k3cloud/rpc/login';
import type { KdSession } from '../../src/main/erp/k3cloud/rpc/http-client';

type Status = 'invalid_configuration' | 'discovery_failed' | 'discovery_only'
  | 'account_not_found' | 'credentials_required' | 'login_failed' | 'accepted' | 'rejected';

export interface DiagnosticSummary {
  status: Status;
  dataCenterCount?: number;
  configuredAccountPresent?: boolean;
  passwordMode?: 'rsa' | 'obfuscation' | 'unknown';
  loginResultType?: -3 | -2 | -1 | 0 | 1 | 'other';
}

/** Only fixed labels, booleans and bounded result codes cross the output boundary. */
export async function diagnoseLogin(env: NodeJS.ProcessEnv): Promise<DiagnosticSummary> {
  const baseUrl = env.K3_BASE_URL?.trim();
  try {
    const url = new URL(baseUrl ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return { status: 'invalid_configuration' };
    }
  } catch {
    return { status: 'invalid_configuration' };
  }

  const acctId = env.K3_ACCT_ID?.trim();
  let dataCenterCount: number;
  let configuredAccountPresent: boolean;
  try {
    const centers = await getDataCenterList(baseUrl!, { diagnosticPrivacy: true });
    dataCenterCount = centers.length;
    configuredAccountPresent = centers.some((dc) => dc.id === acctId);
  } catch {
    return { status: 'discovery_failed' };
  }
  // Discovery mode intentionally omits catalog identifiers/names from shareable output.
  if (!acctId) return { status: 'discovery_only', dataCenterCount };
  const catalog = { dataCenterCount, configuredAccountPresent };
  if (!configuredAccountPresent) return { status: 'account_not_found', ...catalog };
  if (!env.K3_USERNAME || !env.K3_PASSWORD) return { status: 'credentials_required', ...catalog };

  const session: KdSession = { baseUrl: baseUrl!, diagnosticPrivacy: true };
  const passwordMode = (): DiagnosticSummary['passwordMode'] => session.obfuscatedKey === undefined
    ? 'unknown' : session.obfuscatedKey ? 'rsa' : 'obfuscation';
  try {
    // login owns the key request, cookie propagation and exactly one ValidateLoginInfo.
    const result = await login({
      baseUrl: baseUrl!, acctId, username: env.K3_USERNAME, password: env.K3_PASSWORD,
    }, { session });
    const code = result.loginResultType;
    return {
      status: result.isSuccess ? 'accepted' : 'rejected', ...catalog,
      passwordMode: passwordMode(),
      loginResultType: code === -3 || code === -2 || code === -1 || code === 0 || code === 1 ? code : 'other',
    };
  } catch {
    // Error.message/stack/cause can contain server bodies, URLs or credentials.
    return { status: 'login_failed', ...catalog, passwordMode: passwordMode() };
  }
}

export async function runLoginDiagnostic(
  env: NodeJS.ProcessEnv,
  output: (line: string) => void = console.log,
): Promise<number> {
  const summary = await diagnoseLogin(env);
  output(JSON.stringify(summary));
  return summary.status === 'accepted' || summary.status === 'discovery_only' ? 0 : 1;
}

// Importing this file for tests must never run a real diagnostic.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runLoginDiagnostic(process.env).then((code) => { process.exitCode = code; }).catch(() => {
    console.error('Login diagnostic failed; details withheld.');
    process.exitCode = 1;
  });
}
