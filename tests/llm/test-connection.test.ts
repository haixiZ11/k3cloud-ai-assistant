import { describe, it, expect, vi } from 'vitest';
import { testProviderConnection } from '../../src/main/llm/test-connection';
import { listModelsForProvider } from '../../src/main/llm/factory';
import { listAnthropicModels } from '../../src/main/llm/anthropic-client';
import { listOllamaModels } from '../../src/main/llm/ollama-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('testProviderConnection', () => {
  it('openai format — posts a tiny chat completion to /v1/chat/completions', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.model).toBe('deepseek-v4-flash');
      expect(body.max_tokens).toBe(8);
      expect(body.stream).toBe(false);
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      return jsonResponse({ choices: [{ message: { content: 'pong' } }] });
    });
    const res = await testProviderConnection({
      providerId: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(res.ok).toBe(true);
    expect(res.baseUrl).toBe('https://api.deepseek.com');
    expect(res.error).toBeUndefined();
  });

  it('anthropic format — posts to /v1/messages with x-api-key headers', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      const headers = init.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-ant');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.model).toBe('claude-haiku-4-5-20251001');
      expect(body.max_tokens).toBe(8);
      return jsonResponse({ content: [] });
    });
    const res = await testProviderConnection({
      providerId: 'claude',
      apiKey: 'sk-ant',
      model: 'claude-haiku-4-5-20251001',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(res.ok).toBe(true);
    expect(res.baseUrl).toBe('https://api.anthropic.com/v1');
  });

  it('ollama format — posts to /api/chat without auth header', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://localhost:11434/api/chat');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.model).toBe('qwen2.5-coder');
      expect(body.stream).toBe(false);
      return jsonResponse({ message: { content: 'pong' } });
    });
    const res = await testProviderConnection({
      providerId: 'ollama',
      model: 'qwen2.5-coder',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(res.ok).toBe(true);
  });

  it('plan accessMode routes to the tokenPlan endpoint', async () => {
    // 用 plan 端点以 /v1 结尾的 qwen,断言不掺入 buildOpenAiEndpoint 的
    // /v1 补全逻辑(doubao 的 /api/coding/v3 会被补成 /api/coding/v3/v1 —
    // 那是既有生产行为,与本测试无关)。
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://coding.dashscope.aliyuncs.com/v1/chat/completions');
      return jsonResponse({ choices: [] });
    });
    const res = await testProviderConnection({
      providerId: 'qwen',
      apiKey: 'k',
      model: 'm',
      accessMode: 'plan',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(res.ok).toBe(true);
    expect(res.baseUrl).toBe('https://coding.dashscope.aliyuncs.com/v1');
  });

  it('baseUrlOverride wins over both defaults', async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://gateway.corp.internal/v1/chat/completions');
      return jsonResponse({ choices: [] });
    });
    const res = await testProviderConnection({
      providerId: 'deepseek',
      apiKey: 'k',
      model: 'm',
      baseUrlOverride: 'https://gateway.corp.internal/v1',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(res.ok).toBe(true);
    expect(res.baseUrl).toBe('https://gateway.corp.internal/v1');
  });

  it('versioned roots (GLM /v4) get NO /v1 appended — 用户实测 404 回归锁', async () => {
    // 用户报告:智谱连通性测试 404,path=/v4/v1/chat/completions。
    // buildOpenAiEndpoint 旧逻辑对所有非 /v1 结尾的根强拼 /v1,把
    // https://open.bigmodel.cn/api/paas/v4 打成 /api/paas/v4/v1/...。
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions');
      return jsonResponse({ choices: [] });
    });
    const res = await testProviderConnection({
      providerId: 'glm',
      apiKey: 'k',
      model: 'glm-4.7-flashx',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(res.ok).toBe(true);
    expect(res.baseUrl).toBe('https://open.bigmodel.cn/api/paas/v4');
  });

  it('doubao payg root (/api/v3) also stays intact', async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
      return jsonResponse({ choices: [] });
    });
    const res = await testProviderConnection({
      providerId: 'doubao',
      apiKey: 'k',
      model: 'doubao-seed-2-0-pro-260215',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(res.ok).toBe(true);
  });

  it('bare host still gets /v1 appended (deepseek)', async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
      return jsonResponse({ choices: [] });
    });
    const res = await testProviderConnection({
      providerId: 'deepseek',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(res.ok).toBe(true);
  });

  it('non-200 → ok:false with status + body snippet', async () => {
    const fetch = vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 }));
    const res = await testProviderConnection({
      providerId: 'deepseek',
      apiKey: 'bad',
      model: 'm',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('401');
    expect(res.error).toContain('bad key');
  });

  it('missing model → fails fast with "no model selected"', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('should not be called');
    });
    const res = await testProviderConnection({
      providerId: 'deepseek',
      apiKey: 'k',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('no model');
  });

  it('network error → ok:false with the error message', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const res = await testProviderConnection({
      providerId: 'deepseek',
      apiKey: 'k',
      model: 'm',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('fetch failed');
  });

  it('custom-openai without base URL → fails fast', async () => {
    const res = await testProviderConnection({
      providerId: 'custom-openai',
      model: 'm'
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('base URL');
  });
});

describe('listModelsForProvider', () => {
  it('openai format — GET /v1/models with Bearer auth', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.deepseek.com/v1/models');
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk');
      return jsonResponse({
        data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v5-preview' }, { id: 'deepseek-v4-flash' }]
      });
    });
    const models = await listModelsForProvider('deepseek', {
      apiKey: 'sk',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(models).toEqual(['deepseek-v4-flash', 'deepseek-v5-preview']);
  });

  it('anthropic format — GET /v1/models with x-api-key', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.anthropic.com/v1/models');
      expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
      return jsonResponse({ data: [{ id: 'claude-opus-4-9' }] });
    });
    const models = await listModelsForProvider('claude', {
      apiKey: 'k',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(models).toEqual(['claude-opus-4-9']);
  });

  it('ollama format — GET /api/tags, names as ids, no auth', async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe('http://localhost:11434/api/tags');
      return jsonResponse({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'llama3.1:8b' }] });
    });
    const models = await listModelsForProvider('ollama', {
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(models).toEqual(['qwen2.5-coder:7b', 'llama3.1:8b']);
  });

  it('HTTP failure propagates so IPC can surface { ok:false }', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(
      listModelsForProvider('deepseek', { apiKey: 'k', fetchImpl: fetch as unknown as typeof fetch })
    ).rejects.toThrow('500');
  });
});

describe('listAnthropicModels / listOllamaModels (direct)', () => {
  it('anthropic client list normalizes and dedupes ids', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ data: [{ id: ' a ' }, { id: 'a' }, { id: 'b' }, {}] })
    );
    const models = await listAnthropicModels({
      baseUrl: 'https://x/v1',
      apiKey: 'k',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(models).toEqual(['a', 'b']);
  });

  it('ollama client list reads models[].name', async () => {
    const fetch = vi.fn(async () => jsonResponse({ models: [{ name: 'm1' }, { name: 'm2' }] }));
    const models = await listOllamaModels({
      baseUrl: 'http://localhost:11434',
      fetchImpl: fetch as unknown as typeof fetch
    });
    expect(models).toEqual(['m1', 'm2']);
  });
});
