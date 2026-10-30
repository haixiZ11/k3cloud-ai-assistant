import { afterEach, describe, expect, it, vi } from 'vitest';
import { constants, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { runLoginDiagnostic } from '../../scripts/bos-recon/diagnose-login';
import { decodeAppLayerString } from '../../src/main/erp/k3cloud/rpc/codec';
import { obfuscatePassword } from '../../src/main/erp/k3cloud/rpc/password';

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../src/main/logger', () => ({ createLogger: () => log }));
const env = {
  K3_BASE_URL: 'https://example.test/k3cloud', K3_ACCT_ID: 'synthetic-account',
  K3_USERNAME: 'synthetic-user', K3_PASSWORD: 'synthetic-password',
};
const secret = 'SYNTHETIC-DO-NOT-OUTPUT-0123456789';
const body = (LoginResultType: unknown) => JSON.stringify({
  LoginResultType, Message: secret, MessageCode: secret, AccessToken: secret,
  Context: { SessionId: secret, UserName: secret, CustomName: secret }, KDSVCSessionId: secret,
});
type Call = { method: string; headers: Headers; form: URLSearchParams };

function transport(options: { result?: unknown; key?: string; failure?: string; stage?: string } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = url.split('.').at(-3)!;
    calls.push({ method, headers: new Headers(init?.headers), form: new URLSearchParams(String(init?.body)) });
    if (method === (options.stage ?? 'ValidateLoginInfo') && options.failure) {
      if (options.failure === 'transport') throw new Error(secret, { cause: new Error(secret) });
      if (options.failure === 'non-error') throw { message: secret, responseBody: secret };
      if (options.failure === 'stream') return new Response(new ReadableStream({
        start(controller) { controller.error(new Error(secret)); },
      }));
      const reply = options.failure === 'http-success-body' ? body(1)
        : options.failure === 'envelope' ? `response_error: ${secret}`
        : options.failure === 'rejection' ? `ByRspRetStatusCode ${secret}`
          : options.failure === 'empty' ? '' : secret;
      return new Response(reply, { status: options.failure.startsWith('http') ? 500 : 200 });
    }
    if (method === 'GetDataCenterList') return new Response(JSON.stringify([
      { Id: env.K3_ACCT_ID, Number: secret, Name: secret },
    ]));
    if (method === 'GetPublicKeyInfo') {
      // A redundant key fetch would rotate both key and cookie and break this attempt.
      const count = calls.filter((call) => call.method === method).length;
      return new Response(JSON.stringify(count === 1 ? (options.key ?? '') : 'invalid-rotated-key'), {
        headers: { 'Set-Cookie': `ASP.NET_SessionId=synthetic-cookie-${count}; Path=/` },
      });
    }
    if (method === 'ValidateLoginInfo') return new Response(body(options.result ?? 1));
    throw new Error('Unexpected synthetic RPC');
  }));
  return calls;
}

async function run(config: NodeJS.ProcessEnv = env) {
  const output = vi.fn();
  const code = await runLoginDiagnostic(config, output);
  expect(output).toHaveBeenCalledOnce();
  const text = output.mock.calls[0][0] as string;
  for (const value of [secret, secret.slice(0, 16), env.K3_PASSWORD, obfuscatePassword(env.K3_PASSWORD),
    env.K3_USERNAME, env.K3_ACCT_ID, env.K3_BASE_URL, 'synthetic-cookie']) expect(text).not.toContain(value);
  expect(log.info).not.toHaveBeenCalled();
  expect(log.warn).not.toHaveBeenCalled();
  expect(log.error).not.toHaveBeenCalled();
  return { code, summary: JSON.parse(text) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('shareable login diagnosis (synthetic transport only)', () => {
  it.each([undefined, '', '   '])('never authenticates without an explicit account (%s)', async (acctId) => {
    const calls = transport();
    expect(await run({ ...env, K3_ACCT_ID: acctId, K3_USERNAME: undefined, K3_PASSWORD: undefined }))
      .toEqual({ code: 0, summary: { status: 'discovery_only', dataCenterCount: 1 } });
    expect(calls.map((call) => call.method)).toEqual(['GetDataCenterList']);
  });

  it.each(['', 'bad-url', 'ftp://example.test', 'https://user:secret@example.test',
    'https://example.test?token=secret', 'https://example.test#secret'])(
    'rejects unsafe/absent URL configuration without a request (%s)', async (baseUrl) => {
      const calls = transport();
      expect((await run({ ...env, K3_BASE_URL: baseUrl })).summary.status).toBe('invalid_configuration');
      expect(calls).toHaveLength(0);
    },
  );

  it.each(['account', 'credentials'])('does not authenticate when %s is missing', async (missing) => {
    const calls = transport();
    const result = await run(missing === 'account'
      ? { ...env, K3_ACCT_ID: 'missing-account' } : { ...env, K3_PASSWORD: undefined });
    expect(result.code).toBe(1);
    expect(result.summary.status).toBe(missing === 'account' ? 'account_not_found' : 'credentials_required');
    expect(calls.map((call) => call.method)).toEqual(['GetDataCenterList']);
  });

  it.each([1, 0, -1, -2, -3, 99, secret])('summarizes one authentication result without server text (%s)', async (result) => {
    const calls = transport({ result });
    const summary = await run();
    expect(summary.code).toBe(result === 1 ? 0 : 1);
    expect(summary.summary).toEqual({
      status: result === 1 ? 'accepted' : 'rejected', dataCenterCount: 1,
      configuredAccountPresent: true, passwordMode: 'obfuscation',
      loginResultType: [1, 0, -1, -2, -3].includes(Number(result)) ? result : 'other',
    });
    expect(calls.map((call) => call.method)).toEqual(['GetDataCenterList', 'GetPublicKeyInfo', 'ValidateLoginInfo']);
    expect(calls[2].headers.get('cookie')).toBe('ASP.NET_SessionId=synthetic-cookie-1');
    const wire = JSON.parse(decodeAppLayerString(calls[2].form.get('ap1')!));
    expect(wire.AcctID).toBe(env.K3_ACCT_ID);
    expect(wire.Password).toBe(obfuscatePassword(env.K3_PASSWORD));
  });

  it('uses the key and cookie from the same single handshake (RSA)', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const key = obfuscatePassword(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
    const calls = transport({ key });
    expect((await run()).summary.passwordMode).toBe('rsa');
    expect(calls.map((call) => call.method)).toEqual(['GetDataCenterList', 'GetPublicKeyInfo', 'ValidateLoginInfo']);
    expect(calls[2].headers.get('cookie')).toBe('ASP.NET_SessionId=synthetic-cookie-1');
    const wire = JSON.parse(decodeAppLayerString(calls[2].form.get('ap1')!));
    // Check PKCS#1 v1.5 padded plaintext without enabling legacy private-decrypt padding.
    const padded = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, Buffer.from(wire.Password, 'base64'));
    expect(padded.subarray(0, 2)).toEqual(Buffer.from([0, 2]));
    expect(padded.subarray(padded.indexOf(0, 2) + 1).toString()).toBe(env.K3_PASSWORD);
  });

  it.each(['transport', 'non-error', 'stream', 'envelope', 'rejection', 'http', 'http-success-body', 'malformed', 'empty'])(
    'handles %s without logging details or retrying authentication', async (failure) => {
      const calls = transport({ failure });
      const result = await run();
      expect(result.code).toBe(1);
      expect(result.summary.status).toBe(failure === 'empty' ? 'rejected' : 'login_failed');
      expect(calls.filter((call) => call.method === 'ValidateLoginInfo')).toHaveLength(1);
    },
  );

  it.each(['GetDataCenterList', 'GetPublicKeyInfo'])('stops before authentication on %s failure', async (stage) => {
    const calls = transport({ stage, failure: 'transport' });
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.summary.status).toBe(stage === 'GetDataCenterList' ? 'discovery_failed' : 'login_failed');
    expect(calls.some((call) => call.method === 'ValidateLoginInfo')).toBe(false);
  });

  it('does not authenticate with malformed public key material', async () => {
    const calls = transport({ key: obfuscatePassword(secret) });
    expect((await run()).summary.status).toBe('login_failed');
    expect(calls.some((call) => call.method === 'ValidateLoginInfo')).toBe(false);
  });
});
