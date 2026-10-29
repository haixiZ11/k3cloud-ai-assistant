import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import {
  CaptchaLoginError,
  CaptchaRequiredError,
  K3CloudConnector,
} from '../../src/main/erp/k3cloud/connector';
import { encodeAppLayer } from '../../src/main/erp/k3cloud/rpc/codec';

// No real ERP requests or application log writes in login regressions.
vi.mock('../../src/main/logger', () => ({
  createLogger: () => ({ info: vi.fn() }),
}));

const credentials = {
  baseUrl: 'http://localhost/k3cloud',
  acctId: 'test-account',
  username: 'test-user',
  password: 'test-password',
  devCode: 'TEST',
};

interface LoginReply {
  LoginResultType: number;
  Message?: string;
  MessageCode?: string;
}

const captchaRequired: LoginReply = {
  LoginResultType: 0,
  MessageCode: '002099000005374',
  Message: '请输入系统验证码',
};

function mockLogin(replies: LoginReply[]) {
  const queue = [...replies];
  const calls: Array<{ url: string; cookie: string | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, cookie: new Headers(init?.headers).get('cookie') });
    if (url.includes('GetPublicKeyInfo')) {
      return new Response(encodeAppLayer('""'), {
        headers: { 'Set-Cookie': 'ASP.NET_SessionId=test-asp; Path=/' },
      });
    }
    if (url.includes('GetValidationCodeImageByte')) {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      return new Response(encodeAppLayer(JSON.stringify(png.toString('base64'))));
    }
    if (url.includes('ValidateLoginInfo')) {
      const reply = queue.shift();
      if (!reply) throw new Error('unexpected extra login attempt');
      return new Response(encodeAppLayer(JSON.stringify({
        ...reply,
        KDSVCSessionId: 'test-kd',
      })));
    }
    throw new Error(`unexpected RPC: ${url}`);
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('BOS login policy diagnostics (issues #13 / #7)', () => {
  it.each(['direct', 'captcha'] as const)(
    '%s: preserves bad-credentials response without inventing password expiry',
    async (flow) => {
      const failure = {
        LoginResultType: 0,
        MessageCode: 'CheckPasswordPolicy',
        Message: '用户名或密码错误！',
      };
      mockLogin(flow === 'captcha' ? [captchaRequired, failure] : [failure]);
      const connector = new K3CloudConnector(credentials);
      if (flow === 'captcha') {
        await expect(connector.connect()).rejects.toBeInstanceOf(CaptchaRequiredError);
      }
      const error = await (flow === 'captcha' ? connector.submitCaptcha('1234') : connector.connect())
        .catch((err: Error) => err);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(failure.Message);
      expect((error as Error).message).not.toMatch(/密码已过期|验证码已通过|重置密码/);
      expect((error as Error).message).toContain('CheckPasswordPolicy');
      expect(connector.getSession()).toBeNull();
      await expect(connector.getObject('TEST_FORM')).rejects.toThrow(/not connected/);
      await expect(connector.fetchCaptchaImage()).rejects.toThrow(/no pending captcha/);
    },
  );

  it.each([undefined, ''])(
    'missing policy message (%s) does not imply expiry',
    async (Message) => {
      mockLogin([{ LoginResultType: 0, MessageCode: 'CheckPasswordPolicy', Message }]);
      const connector = new K3CloudConnector(credentials);
      await expect(connector.connect()).rejects.toThrow(/服务端拒绝登录/);
      expect(connector.getSession()).toBeNull();
    },
  );

  it.each(['direct', 'captcha'] as const)('%s: hard expiry still rejects the session', async (flow) => {
    const failure = {
      LoginResultType: 0,
      MessageCode: 'CheckPasswordPolicy',
      Message: '用户密码已过期',
    };
    mockLogin(flow === 'captcha' ? [captchaRequired, failure] : [failure]);
    const connector = new K3CloudConnector(credentials);
    if (flow === 'captcha') {
      await expect(connector.connect()).rejects.toBeInstanceOf(CaptchaRequiredError);
    }
    await expect(flow === 'captcha' ? connector.submitCaptcha('1234') : connector.connect())
      .rejects.toThrow(failure.Message);
    expect(connector.getSession()).toBeNull();
    await expect(connector.getObject('TEST_FORM')).rejects.toThrow(/not connected/);
  });

  it.each(['direct', 'captcha'] as const)('%s: successful expiry advisory still connects', async (flow) => {
    const success = {
      LoginResultType: 1,
      MessageCode: 'CheckPasswordPolicy',
      Message: '密码将在3天后过期',
    };
    mockLogin(flow === 'captcha' ? [captchaRequired, success] : [success]);
    const connector = new K3CloudConnector(credentials);
    if (flow === 'captcha') {
      await expect(connector.connect()).rejects.toBeInstanceOf(CaptchaRequiredError);
      await connector.submitCaptcha('1234');
    } else {
      await connector.connect();
    }
    expect(connector.getSession()?.kdServiceSessionId).toBe('test-kd');
  });

  it.each([
    ['002099000005375', '系统验证码输入错误', 'wrong'],
    ['002099000005373', '系统验证码不存在,请刷新验证码', 'expired'],
    [undefined, '系统验证码输入错误', 'wrong'],
  ])('CAPTCHA failure %s remains retryable on the same session', async (MessageCode, Message, kind) => {
    const calls = mockLogin([
      captchaRequired,
      { LoginResultType: 0, MessageCode, Message },
      { LoginResultType: 1 },
    ]);
    const connector = new K3CloudConnector(credentials);
    await expect(connector.connect()).rejects.toBeInstanceOf(CaptchaRequiredError);
    expect((await connector.fetchCaptchaImage()).dataUrl).toMatch(/^data:image\/png;base64,/);
    await expect(connector.submitCaptcha('bad')).rejects.toMatchObject({
      name: CaptchaLoginError.name, kind,
    });
    expect(connector.getSession()).toBeNull();
    await connector.fetchCaptchaImage();
    await connector.submitCaptcha('good');
    expect(connector.getSession()).not.toBeNull();
    expect(calls.filter((c) => c.url.includes('GetPublicKeyInfo'))).toHaveLength(1);
    for (const call of calls.slice(1)) expect(call.cookie).toContain('ASP.NET_SessionId=test-asp');
  });
});
