import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderProbe,
  probeConfig,
} from '../../src/renderer/stores/provider-probe';
import { DEFAULT_SETTINGS } from '../../src/shared/types';

const base = probeConfig(DEFAULT_SETTINGS, 'deepseek', 'payg', {
  apiKey: 'synthetic-key',
  model: 'synthetic-model',
});
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup(timeout = 25) {
  const transport = {
    llmListModels: vi
      .fn()
      .mockResolvedValue({ ok: true, models: ['synthetic-model'] }),
    llmTestConnection: vi
      .fn()
      .mockResolvedValue({ ok: true, latencyMs: 1, baseUrl: '' }),
    llmCancelProbe: vi.fn().mockResolvedValue(undefined),
  };
  const probe = new ProviderProbe(transport, timeout);
  probe.configure(base);
  return { probe, transport };
}
afterEach(() => vi.useRealTimers());

describe('configuration isolated probe cache', () => {
  it.each(['providerId', 'accessMode', 'apiKey', 'baseUrlOverride'] as const)(
    'does not reuse a catalog when %s differs',
    async (field) => {
      const { probe, transport } = setup();
      probe.catalog();
      await flush();
      probe.configure({
        ...base,
        [field]: field === 'accessMode' ? 'plan' : `different-${field}`,
      });
      expect(probe.getSnapshot().models).toEqual([]);
      probe.catalog();
      await flush();
      expect(transport.llmListModels).toHaveBeenCalledTimes(2);
      probe.configure(base);
      probe.catalog();
      await flush();
      expect(transport.llmListModels).toHaveBeenCalledTimes(2);
      expect(probe.getSnapshot().models).toEqual(['synthetic-model']);
    },
  );
  it('expires entries after five minutes', async () => {
    vi.useFakeTimers();
    const { probe, transport } = setup();
    probe.catalog();
    await flush();
    await vi.advanceTimersByTimeAsync(300_001);
    probe.catalog();
    await flush();
    expect(transport.llmListModels).toHaveBeenCalledTimes(2);
  });
  it('captures immutable configuration and deduplicates pending repeated clicks', async () => {
    const { probe, transport } = setup();
    const source = { ...base };
    probe.configure(source);
    transport.llmTestConnection.mockReturnValue(new Promise(() => {}));
    probe.test(source);
    probe.test(source);
    source.apiKey = 'changed-after-dispatch';
    await flush();
    expect(transport.llmTestConnection).toHaveBeenCalledTimes(1);
    const request = transport.llmTestConnection.mock.calls[0][0];
    expect(request.apiKey).toBe('synthetic-key');
    expect(Object.isFrozen(request)).toBe(true);
    probe.cancel();
  });
  it('bounds hung IPC, cancels it and ignores the late result after retry', async () => {
    vi.useFakeTimers();
    const { probe, transport } = setup();
    let resolve!: (value: unknown) => void;
    transport.llmTestConnection.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    probe.test(base);
    await flush();
    await vi.advanceTimersByTimeAsync(26);
    expect(probe.getSnapshot().testing).toBe(false);
    expect(probe.getSnapshot().result?.error).toContain('timed out');
    expect(transport.llmCancelProbe).toHaveBeenCalledOnce();
    probe.test(base);
    await flush();
    resolve({ ok: false, latencyMs: 0, baseUrl: '', error: 'stale' });
    await flush();
    expect(probe.getSnapshot().result?.ok).toBe(true);
  });
  it('recovers from rejected IPC promises and allows retries', async () => {
    const { probe, transport } = setup();
    transport.llmListModels.mockRejectedValueOnce(
      new Error('synthetic-failure'),
    );
    transport.llmTestConnection.mockRejectedValueOnce(
      new Error('synthetic-failure'),
    );
    probe.catalog();
    probe.test(base);
    await flush();
    expect(probe.getSnapshot().testing).toBe(false);
    probe.catalog();
    probe.test(base);
    await flush();
    expect(probe.getSnapshot().models).toEqual(['synthetic-model']);
    expect(probe.getSnapshot().result?.ok).toBe(true);
  });
  it('invalidates save checkpoints even after returning to the same configuration', () => {
    const { probe } = setup();
    const current = probe.checkpoint();
    probe.configure(null);
    probe.configure(base);
    expect(current()).toBe(false);
  });
  it('does not dispatch when cancelled before the IPC microtask', async () => {
    const { probe, transport } = setup();
    probe.test(base);
    probe.cancel();
    await flush();
    expect(transport.llmTestConnection).not.toHaveBeenCalled();
  });
});
