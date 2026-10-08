import type { LlmClient, ProviderConfig } from './types';
import { PROVIDER_CONFIGS } from './types';
import { createOpenAiClient, listOpenAiModels } from './openai-client';
import { createAnthropicClient, listAnthropicModels } from './anthropic-client';
import { createOllamaClient, listOllamaModels } from './ollama-client';

export type AccessMode = 'payg' | 'plan';

export interface ClientOptions {
  /**
   * 'payg' (default) hits the standard base URL.
   * 'plan' swaps to `ProviderConfig.tokenPlan.baseUrl` when the provider
   * declares one — for providers without a tokenPlan endpoint we silently
   * fall back to standard so the UI never traps a user in a broken state.
   */
  accessMode?: AccessMode;
  /**
   * Per-provider override (highest priority). Used by the Settings 高级 抽屉
   * for users who route through a corporate proxy or a third-party gateway
   * that doesn't fit either standard or plan endpoint.
   */
  baseUrlOverride?: string;
}

export interface ResolvedEndpoint {
  baseUrl: string;
  defaultModel: string;
  format: ProviderConfig['format'];
}

export function resolveProviderEndpoint(
  providerId: string,
  opts: ClientOptions = {}
): ResolvedEndpoint {
  const cfg = PROVIDER_CONFIGS[providerId];
  if (!cfg) throw new Error(`Unknown provider: ${providerId}`);

  if (opts.baseUrlOverride && opts.baseUrlOverride.trim() !== '') {
    return { baseUrl: opts.baseUrlOverride, defaultModel: cfg.defaultModel, format: cfg.format };
  }
  const baseUrl =
    opts.accessMode === 'plan' && cfg.tokenPlan
      ? cfg.tokenPlan.baseUrl
      : cfg.baseUrl;
  return { baseUrl, defaultModel: cfg.defaultModel, format: cfg.format };
}

export function createLlmClient(providerId: string, opts: ClientOptions = {}): LlmClient {
  const { baseUrl, defaultModel, format } = resolveProviderEndpoint(providerId, opts);

  switch (format) {
    case 'openai':
      return createOpenAiClient({ baseUrl, defaultModel });
    case 'anthropic':
      return createAnthropicClient({ baseUrl, defaultModel });
    case 'ollama':
      return createOllamaClient({ baseUrl, defaultModel });
  }
}

export interface ListModelsOptions extends ClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch the provider's live model catalog. Dispatches on the provider's wire
 * format: OpenAI-compatible → GET /v1/models, Anthropic → GET /v1/models,
 * Ollama → GET /api/tags. Throws on network/HTTP failure — the IPC layer
 * catches and surfaces `{ ok: false, error }` so the renderer can silently
 * fall back to the bundled catalog.
 */
export async function listModelsForProvider(
  providerId: string,
  opts: ListModelsOptions = {}
): Promise<string[]> {
  // custom-openai has no built-in endpoint — the renderer supplies its
  // customOpenAI.baseUrl via baseUrlOverride.
  if (providerId === 'custom-openai') {
    const baseUrl = opts.baseUrlOverride?.trim();
    if (!baseUrl) throw new Error('custom-openai requires a base URL');
    return listOpenAiModels({ baseUrl, apiKey: opts.apiKey, fetchImpl: opts.fetchImpl });
  }
  const { baseUrl, format } = resolveProviderEndpoint(providerId, opts);
  switch (format) {
    case 'anthropic':
      return listAnthropicModels({ baseUrl, apiKey: opts.apiKey, fetchImpl: opts.fetchImpl });
    case 'ollama':
      return listOllamaModels({ baseUrl, fetchImpl: opts.fetchImpl });
    default:
      return listOpenAiModels({ baseUrl, apiKey: opts.apiKey, fetchImpl: opts.fetchImpl });
  }
}
