import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { registerProviderProbeIpc } from '../../src/main/llm/probe-ipc';

type Handler = Parameters<IpcMain['handle']>[1];
function harness() {
  const handlers = new Map<string, Handler>();
  registerProviderProbeIpc({
    handle: (name, handler) => {
      handlers.set(name, handler);
    },
  });
  const event = (id: number) =>
    ({
      sender: Object.assign(new EventEmitter(), { id }),
    }) as unknown as IpcMainInvokeEvent;
  const invoke = (name: string, sender: IpcMainInvokeEvent, arg: unknown) =>
    handlers.get(name)!(sender, arg);
  return { event, invoke };
}
const request = {
  requestId: 'synthetic-id',
  providerId: 'custom-openai',
  apiKey: 'synthetic-key',
  model: 'synthetic-model',
  accessMode: 'payg' as const,
  baseUrlOverride: 'https://synthetic.test/v3',
};
afterEach(() => vi.unstubAllGlobals());

describe('probe IPC lifecycle', () => {
  it('uses the explicit snapshot endpoint/key without consulting mutable persisted settings', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 'synthetic-model' }] })),
    );
    vi.stubGlobal('fetch', fetch);
    const { event, invoke } = harness();
    const input = { ...request };
    const result = invoke('llm:listModels', event(1), input);
    input.baseUrlOverride = 'https://changed.test';
    input.apiKey = 'changed';
    expect(await result).toEqual({ ok: true, models: ['synthetic-model'] });
    expect(fetch).toHaveBeenCalledWith(
      'https://synthetic.test/v3/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer synthetic-key' },
      }),
    );
  });
  it('scopes cancellation to the requesting renderer even when IDs are equal', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        signals.push(init.signal as AbortSignal);
        return new Promise(() => {});
      }),
    );
    const { event, invoke } = harness();
    const first = event(1);
    const second = event(2);
    const a = invoke('llm:listModels', first, request);
    const b = invoke('llm:listModels', second, request);
    await invoke('llm:cancelProbe', second, request.requestId);
    expect(signals[0].aborted).toBe(false);
    expect(signals[1].aborted).toBe(true);
    expect(await b).toMatchObject({ ok: false });
    await invoke('llm:cancelProbe', first, request.requestId);
    expect(await a).toMatchObject({ ok: false });
    expect(first.sender.listenerCount('destroyed')).toBe(0);
    expect(second.sender.listenerCount('destroyed')).toBe(0);
  });
  it('aborts connectivity requests when the renderer is destroyed', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: unknown, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise(() => {});
      }),
    );
    const { event, invoke } = harness();
    const sender = event(1);
    const result = invoke('llm:testConnection', sender, request);
    sender.sender.emit('destroyed');
    expect(await result).toMatchObject({ ok: false, error: 'Probe cancelled' });
    expect(signal?.aborted).toBe(true);
    expect(sender.sender.listenerCount('destroyed')).toBe(0);
  });
  it('does not let an old finally remove a replacement request with the same ID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const { event, invoke } = harness();
    const sender = event(1);
    const old = invoke('llm:listModels', sender, request);
    const next = invoke('llm:listModels', sender, request);
    expect(await old).toMatchObject({ ok: false });
    await invoke('llm:cancelProbe', sender, request.requestId);
    expect(await next).toMatchObject({ ok: false });
    expect(sender.sender.listenerCount('destroyed')).toBe(0);
  });
});
