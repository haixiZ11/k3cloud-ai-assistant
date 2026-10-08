import { resolveProviderEndpoint } from './factory';
import { buildOpenAiEndpoint } from './openai-client';

export interface TestConnectionInput {
  providerId: string;
  apiKey?: string;
  /** 要打的模型 id — 连通性测试连带验证模型可访问,未选模型时直接报错。 */
  model?: string;
  accessMode?: 'payg' | 'plan';
  baseUrlOverride?: string;
  timeoutMs?: number;
  /** Override for tests */
  fetchImpl?: typeof fetch;
}

export interface TestConnectionOutcome {
  ok: boolean;
  latencyMs: number;
  /** 实际请求的 URL — UI 显示出来,配置错端点时一眼定位。 */
  baseUrl: string;
  error?: string;
}

const PING_MESSAGES = [{ role: 'user', content: 'ping' }];
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Connectivity probe: one tiny real request (max_tokens=8, "ping") through
 * the same endpoint resolution the chat path uses. Deliberately NOT a
 * /models GET — some gateways authorize that endpoint differently, and a
 * chat completion also verifies the selected model is reachable.
 */
export async function testProviderConnection(
  input: TestConnectionInput
): Promise<TestConnectionOutcome> {
  const started = Date.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  const elapsed = (): number => Date.now() - started;

  let baseUrl: string;
  let format: 'openai' | 'anthropic' | 'ollama';
  if (input.providerId === 'custom-openai') {
    baseUrl = input.baseUrlOverride?.trim() ?? '';
    format = 'openai';
    if (!baseUrl) {
      return { ok: false, latencyMs: elapsed(), baseUrl: '', error: 'custom-openai requires a base URL' };
    }
  } else {
    try {
      const ep = resolveProviderEndpoint(input.providerId, {
        accessMode: input.accessMode,
        baseUrlOverride: input.baseUrlOverride
      });
      baseUrl = ep.baseUrl;
      format = ep.format;
    } catch (err) {
      return {
        ok: false,
        latencyMs: elapsed(),
        baseUrl: '',
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  const model = input.model?.trim();
  if (!model) {
    return { ok: false, latencyMs: elapsed(), baseUrl, error: 'no model selected' };
  }

  let url: string;
  let headers: Record<string, string>;
  let body: Record<string, unknown>;
  if (format === 'anthropic') {
    url = `${baseUrl}/messages`;
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey ?? '',
      'anthropic-version': '2023-06-01'
    };
    body = { model, max_tokens: 8, messages: PING_MESSAGES };
  } else if (format === 'ollama') {
    url = `${baseUrl}/api/chat`;
    headers = { 'Content-Type': 'application/json' };
    body = { model, messages: PING_MESSAGES, stream: false };
  } else {
    url = buildOpenAiEndpoint(baseUrl, '/chat/completions');
    headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey ?? ''}` };
    body = { model, messages: PING_MESSAGES, max_tokens: 8, stream: false };
  }

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      return { ok: false, latencyMs: elapsed(), baseUrl, error: `HTTP ${response.status}: ${text}` };
    }
    return { ok: true, latencyMs: elapsed(), baseUrl };
  } catch (err) {
    return {
      ok: false,
      latencyMs: elapsed(),
      baseUrl,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
