import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import type { LlmProviderProbeRequest } from '@shared/types';
import { listModelsForProvider } from './factory';
import { testProviderConnection } from './test-connection';

export function registerProviderProbeIpc(ipc: Pick<IpcMain, 'handle'>): void {
  const active = new Map<string, AbortController>();
  const run = async <T>(
    event: IpcMainInvokeEvent,
    request: LlmProviderProbeRequest,
    task: (
      snapshot: Readonly<LlmProviderProbeRequest>,
      signal: AbortSignal,
    ) => Promise<T>,
  ): Promise<T> => {
    const snapshot = Object.freeze({ ...request });
    const id = `${event.sender.id}/${snapshot.requestId ?? randomUUID()}`;
    active.get(id)?.abort();
    const controller = new AbortController();
    active.set(id, controller);
    const destroyed = () => controller.abort();
    event.sender.once('destroyed', destroyed);
    try {
      return await task(snapshot, controller.signal);
    } finally {
      event.sender.removeListener('destroyed', destroyed);
      if (active.get(id) === controller) active.delete(id);
    }
  };

  ipc.handle('llm:cancelProbe', (event, requestId: string) => {
    active.get(`${event.sender.id}/${requestId}`)?.abort();
  });
  ipc.handle('llm:listModels', async (event, req: LlmProviderProbeRequest) => {
    try {
      return await run(event, req, async (snapshot, signal) => ({
        ok: true,
        models: await listModelsForProvider(snapshot.providerId, {
          ...snapshot,
          signal,
        }),
      }));
    } catch {
      return {
        ok: false,
        error: 'Model catalog request failed or was cancelled',
      };
    }
  });
  ipc.handle('llm:testConnection', (event, req: LlmProviderProbeRequest) =>
    run(event, req, (snapshot, signal) =>
      testProviderConnection({ ...snapshot, signal }),
    ),
  );
}
