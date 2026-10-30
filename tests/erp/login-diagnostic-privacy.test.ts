import { afterEach, describe, expect, it, vi } from 'vitest';
import { login } from '../../src/main/erp/k3cloud/rpc/login';
import { callKdsvc } from '../../src/main/erp/k3cloud/rpc/http-client';

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../src/main/logger', () => ({ createLogger: () => log }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('private diagnostic RPC session', () => {
  it('does not persist session prefixes or server messages during normal login', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
      url.includes('GetPublicKeyInfo') ? '""' : JSON.stringify({
        LoginResultType: -1, Message: 'synthetic-secret', MessageCode: 'synthetic-secret',
      }), { headers: { 'set-cookie': 'ASP.NET_SessionId=synthetic-cookie; Path=/' } },
    )));
    await login({ baseUrl: 'https://example.test', acctId: 'test', username: 'test', password: 'test' }, {
      session: { baseUrl: 'https://example.test', diagnosticPrivacy: true },
    });
    expect(log.info).not.toHaveBeenCalled();
  });

  it.each(['transport', 'envelope', 'rejection', 'http'])(
    'does not persist URL, exception or response contents on %s failure', async (kind) => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        if (kind === 'transport') throw new Error('synthetic-secret');
        return new Response(kind === 'envelope' ? 'response_error: synthetic-secret'
          : kind === 'rejection' ? 'ByRspRetStatusCode synthetic-secret' : 'synthetic-secret',
        { status: kind === 'http' ? 500 : 200 });
      }));
      await callKdsvc({ baseUrl: 'https://example.test', diagnosticPrivacy: true }, 'Test', 'Test', {
        apFields: {},
      }).catch(() => undefined);
      expect(log.error).not.toHaveBeenCalled();
      expect(log.warn).not.toHaveBeenCalled();
    },
  );
});
