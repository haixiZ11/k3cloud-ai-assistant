import { afterEach, describe, expect, it, vi } from 'vitest';
import { listModelsForProvider } from '../../src/main/llm/factory';
import { testProviderConnection } from '../../src/main/llm/test-connection';

afterEach(() => vi.useRealTimers());
describe('bounded probe transport and response bodies', () => {
  it.each(['deepseek', 'claude', 'ollama', 'custom-openai'])(
    'times out a hung %s catalog body and aborts transport',
    async (providerId) => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      const fetchImpl: typeof fetch = vi.fn(async (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Response(new ReadableStream({ start() {} }));
      });
      const result = listModelsForProvider(providerId, {
        apiKey: 'synthetic-key',
        baseUrlOverride: 'https://synthetic.test/v1',
        fetchImpl,
        timeoutMs: 20,
      });
      const assertion = expect(result).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(21);
      await assertion;
      expect(signal?.aborted).toBe(true);
    },
  );
  it.each(['catalog', 'connection'])(
    'cancels a hung %s fetch even if it ignores AbortSignal',
    async (kind) => {
      const controller = new AbortController();
      const fetchImpl: typeof fetch = vi.fn(
        () => new Promise<Response>(() => {}),
      );
      const input = {
        apiKey: 'synthetic-key',
        model: 'synthetic-model',
        fetchImpl,
        signal: controller.signal,
      };
      const result =
        kind === 'catalog'
          ? listModelsForProvider('deepseek', input)
          : testProviderConnection({ ...input, providerId: 'deepseek' });
      controller.abort();
      if (kind === 'catalog') await expect(result).rejects.toThrow('cancelled');
      else
        expect(await result).toMatchObject({
          ok: false,
          error: 'Probe cancelled',
        });
    },
  );
  it('bounds a connectivity error body read', async () => {
    vi.useFakeTimers();
    const result = testProviderConnection({
      providerId: 'custom-openai',
      apiKey: 'synthetic',
      model: 'synthetic',
      baseUrlOverride: 'https://synthetic.test/v3',
      timeoutMs: 15,
      fetchImpl: async () =>
        new Response(new ReadableStream({ start() {} }), { status: 500 }),
    });
    await vi.advanceTimersByTimeAsync(16);
    expect(await result).toMatchObject({ ok: false, error: 'Probe timed out' });
  });
  it('does not send an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();
    await expect(
      listModelsForProvider('deepseek', {
        fetchImpl,
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
