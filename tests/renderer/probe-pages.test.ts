// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsPage } from '../../src/renderer/pages/SettingsPage';
import { WizardPage } from '../../src/renderer/pages/WizardPage';
import { useSettingsStore } from '../../src/renderer/stores/settings-store';
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../src/renderer/i18n', () => ({
  i18n: { changeLanguage: vi.fn() },
}));
let root: Root;
let host: HTMLDivElement;
const api = {
  saveSettings: vi.fn(),
  llmListModels: vi.fn(),
  llmTestConnection: vi.fn(),
  llmCancelProbe: vi.fn(),
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(window, { opendeploy: api });
  api.saveSettings.mockResolvedValue(undefined);
  api.llmListModels.mockResolvedValue({ ok: true, models: [] });
  api.llmTestConnection.mockResolvedValue({
    ok: true,
    latencyMs: 1,
    baseUrl: 'https://synthetic.test',
  });
  api.llmCancelProbe.mockResolvedValue(undefined);
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS },
    loaded: true,
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.useRealTimers();
});

async function click(text: string, within: ParentNode = host) {
  const button = Array.from(within.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  expect(button, text).toBeTruthy();
  await act(async () => button!.click());
}
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function settingsPage(settings: Partial<AppSettings>) {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ...settings } });
  await act(async () => root.render(createElement(SettingsPage)));
  await click('settings.sectionLlm');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function blur(element: HTMLElement) {
  await act(async () =>
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
  );
}
async function provider(id: string) {
  await act(async () =>
    (
      host
        .querySelector(`.prov-dot.${id}`)!
        .closest('.prov-card') as HTMLElement
    ).click(),
  );
}

describe('Settings connection snapshot', () => {
  it.each(['deepseek', 'custom-openai'])('preserves a newer model draft during slow persistence for %s', async (providerId) => {
    await settingsPage({
      llmProvider: providerId,
      customOpenAI: { baseUrl: 'https://synthetic.test/v1', model: 'synthetic-initial' },
    });
    const model = host.querySelector<HTMLInputElement>('input[list="custom-openai-model-list"], input[placeholder="settings.customModelLabel"]')!;
    const saving = deferred<void>();
    api.saveSettings.mockReturnValueOnce(saving.promise);
    await input(model, 'synthetic-model-A');
    await blur(model);
    await input(model, 'synthetic-model-B');
    await act(async () => saving.resolve());
    expect(model.value).toBe('synthetic-model-B');
    await blur(model);
    const settings = useSettingsStore.getState().settings;
    expect(providerId === 'custom-openai' ? settings.customOpenAI?.model : settings.modelByProvider?.[providerId]).toBe('synthetic-model-B');
  });
  it.each(['', 'synthetic-old-key'])(
    'tests the newly saved key, not the previous render (%s)',
    async (oldKey) => {
      await settingsPage({
        llmProvider: 'deepseek',
        apiKeys: { deepseek: oldKey },
      });
      const key = host.querySelector<HTMLInputElement>(
        'input[type="password"]',
      )!;
      await input(key, 'synthetic-new-key');
      await click('settings.save', key.closest('.setting-row')!);
      expect(api.llmTestConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'deepseek',
          accessMode: 'payg',
          apiKey: 'synthetic-new-key',
        }),
      );
    },
  );

  it.each(['payg', 'plan'] as const)(
    'saves and probes the correct %s bucket',
    async (mode) => {
      await settingsPage({
        llmProvider: 'qwen',
        apiAccessMode: { qwen: mode },
        apiKeys: { qwen: 'synthetic-payg-old' },
        planApiKeys: { qwen: 'synthetic-plan-old' },
      });
      const inputs = host.querySelectorAll<HTMLInputElement>(
        'input[type="password"]',
      );
      const key = inputs[mode === 'plan' ? 1 : 0];
      await input(key, `synthetic-${mode}-new`);
      await click('settings.save', key.closest('.setting-row')!);
      expect(api.llmTestConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'qwen',
          accessMode: mode,
          apiKey: `synthetic-${mode}-new`,
        }),
      );
    },
  );

  it('tests custom OpenAI with its own key, model and edited endpoint', async () => {
    await settingsPage({
      llmProvider: 'custom-openai',
      customOpenAI: {
        apiKey: 'synthetic-old',
        model: 'synthetic-model',
        baseUrl: 'https://old.example.test/v3',
      },
    });
    const endpoint = Array.from(
      host.querySelectorAll<HTMLInputElement>('input'),
    ).find((e) => e.value.includes('old.example.test'))!;
    await input(endpoint, 'https://new.example.test/v4');
    const key = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    await input(key, 'synthetic-custom-new');
    await click('settings.save', key.closest('.setting-row')!);
    expect(api.llmTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'custom-openai',
        apiKey: 'synthetic-custom-new',
        model: 'synthetic-model',
        baseUrlOverride: 'https://new.example.test/v4',
      }),
    );
  });

  it('does not probe twice on repeated Save while persistence is pending', async () => {
    await settingsPage({ llmProvider: 'deepseek' });
    const saving = deferred<void>();
    api.saveSettings.mockReturnValueOnce(saving.promise);
    const key = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    await input(key, 'synthetic-new');
    const row = key.closest('.setting-row')!;
    await click('settings.save', row);
    await click('settings.save', row);
    expect(api.saveSettings).toHaveBeenCalledTimes(1);
    expect(api.llmTestConnection).not.toHaveBeenCalled();
    await act(async () => saving.resolve());
    expect(api.llmTestConnection).toHaveBeenCalledTimes(1);
  });

  it.each(['mode', 'provider', 'endpoint', 'key', 'model'])(
    'ignores out-of-order probe results after changing %s',
    async (change) => {
      const old = deferred<{
        ok: boolean;
        latencyMs: number;
        baseUrl: string;
        error: string;
      }>();
      api.llmTestConnection.mockReturnValueOnce(old.promise);
      await settingsPage({
        llmProvider: 'qwen',
        apiKeys: { qwen: 'synthetic-q', claude: 'synthetic-c' },
        planApiKeys: { qwen: 'synthetic-plan' },
      });
      await click('settings.testConnection');
      if (change === 'mode') await click('settings.accessMode.plan');
      if (change === 'provider') await provider('claude');
      if (change === 'key')
        await input(
          host.querySelector<HTMLInputElement>('input[type="password"]')!,
          'synthetic-next',
        );
      if (change === 'endpoint') {
        const endpoint = host.querySelector<HTMLInputElement>(
          'input[placeholder^="https://"]',
        )!;
        await input(endpoint, 'https://synthetic-next.test');
      }
      if (change === 'model')
        await input(
          host.querySelector<HTMLInputElement>(
            'input[placeholder="settings.customModelLabel"]',
          )!,
          'synthetic-next-model',
        );
      expect(api.llmCancelProbe).toHaveBeenCalled();
      await click('settings.testConnection');
      expect(host.textContent).toContain('settings.testOk');
      await act(async () =>
        old.resolve({
          ok: false,
          latencyMs: 1,
          baseUrl: '',
          error: 'STALE-FAILURE',
        }),
      );
      expect(host.textContent).not.toContain('STALE-FAILURE');
      expect(host.textContent).toContain('settings.testOk');
    },
  );

  it('starts the new catalog immediately and discards a late provider/mode catalog', async () => {
    const old = deferred<{ ok: boolean; models: string[] }>();
    api.llmListModels
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ok: true, models: ['plan-only-model'] });
    await settingsPage({
      llmProvider: 'qwen',
      apiKeys: { qwen: 'synthetic-payg' },
      planApiKeys: { qwen: 'synthetic-plan' },
    });
    await click('settings.accessMode.plan');
    expect(api.llmListModels).toHaveBeenCalledTimes(2);
    await act(async () =>
      old.resolve({ ok: true, models: ['stale-payg-model'] }),
    );
    expect(host.textContent).toContain('plan-only-model');
    expect(host.textContent).not.toContain('stale-payg-model');
    expect(
      api.saveSettings.mock.calls.some(([s]) => s.fetchedModelsByProvider),
    ).toBe(false);
  });

  it.each(['navigate', 'cancel', 'unmount'])(
    'invalidates a pending result on %s',
    async (action) => {
      const pending = deferred<{
        ok: boolean;
        latencyMs: number;
        baseUrl: string;
        error: string;
      }>();
      api.llmTestConnection.mockReturnValueOnce(pending.promise);
      await settingsPage({
        llmProvider: 'deepseek',
        apiKeys: { deepseek: 'synthetic-key' },
      });
      await click('settings.testConnection');
      if (action === 'navigate') await click('settings.sectionAppearance');
      if (action === 'cancel') await click('settings.cancelTest');
      if (action === 'unmount') await act(async () => root.unmount());
      expect(api.llmCancelProbe).toHaveBeenCalled();
      await act(async () =>
        pending.resolve({
          ok: false,
          latencyMs: 1,
          baseUrl: '',
          error: 'STALE-FAILURE',
        }),
      );
      expect(host.textContent).not.toContain('STALE-FAILURE');
    },
  );

  it('does not start a paid probe when a key save finishes after navigation', async () => {
    await settingsPage({ llmProvider: 'deepseek' });
    const saving = deferred<void>();
    api.saveSettings.mockReturnValueOnce(saving.promise);
    const key = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    await input(key, 'synthetic-key');
    await click('settings.save', key.closest('.setting-row')!);
    await click('settings.sectionAppearance');
    await act(async () => saving.resolve());
    expect(api.llmTestConnection).not.toHaveBeenCalled();
  });

  it('preserves a provider switch during a slow key save without testing the old configuration', async () => {
    await settingsPage({ llmProvider: 'deepseek' });
    const saving = deferred<void>();
    api.saveSettings.mockReturnValueOnce(saving.promise);
    const key = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    await input(key, 'synthetic-new-key');
    await click('settings.save', key.closest('.setting-row')!);
    await provider('claude');
    await act(async () => saving.resolve());
    expect(useSettingsStore.getState().settings).toMatchObject({
      llmProvider: 'claude',
      apiKeys: { deepseek: 'synthetic-new-key' },
    });
    expect(api.llmTestConnection).not.toHaveBeenCalled();
  });

  it('does not probe failed key persistence and supports retry', async () => {
    await settingsPage({ llmProvider: 'deepseek' });
    api.saveSettings.mockRejectedValueOnce(new Error('synthetic disk error'));
    const key = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    await input(key, 'synthetic-key');
    await click('settings.save', key.closest('.setting-row')!);
    expect(api.llmTestConnection).not.toHaveBeenCalled();
    expect(host.textContent).toContain('settings.saveFailed');
    await click('settings.save', key.closest('.setting-row')!);
    expect(api.llmTestConnection).toHaveBeenCalledOnce();
  });

  it('clears loading after a rejected probe IPC and allows retry', async () => {
    await settingsPage({
      llmProvider: 'deepseek',
      apiKeys: { deepseek: 'synthetic-key' },
    });
    api.llmTestConnection.mockRejectedValueOnce(
      new Error('synthetic bridge error'),
    );
    await click('settings.testConnection');
    expect(host.textContent).toContain('settings.testFailed');
    expect(host.textContent).not.toContain('settings.testing');
    await click('settings.testConnection');
    expect(host.textContent).toContain('settings.testOk');
  });
});

describe('Wizard probe lifecycle', () => {
  async function wizard() {
    await act(async () =>
      root.render(createElement(WizardPage, { onFinish: vi.fn() })),
    );
    await click('wizard.startCta →');
    await provider('qwen');
    const key = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    await input(key, 'synthetic-wizard-key');
    return key;
  }
  it('deduplicates blur, then probes again when only the model changes', async () => {
    const key = await wizard();
    await blur(key);
    await blur(key);
    expect(api.llmTestConnection).toHaveBeenCalledTimes(1);
    const model = host.querySelector<HTMLInputElement>(
      'input[placeholder="settings.customModelLabel"]',
    )!;
    await input(model, 'synthetic-new-model');
    await blur(model);
    expect(api.llmTestConnection).toHaveBeenCalledTimes(2);
    expect(api.llmTestConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'synthetic-new-model' }),
    );
  });
  it('does not let the old provider overwrite the new provider catalog or test result', async () => {
    const oldCatalog = deferred<{ ok: boolean; models: string[] }>();
    const oldTest = deferred<{
      ok: boolean;
      latencyMs: number;
      baseUrl: string;
      error: string;
    }>();
    api.llmListModels.mockReturnValueOnce(oldCatalog.promise);
    api.llmTestConnection.mockReturnValueOnce(oldTest.promise);
    const key = await wizard();
    await blur(key);
    await provider('claude');
    const nextKey = host.querySelector<HTMLInputElement>(
      'input[type="password"]',
    )!;
    await input(nextKey, 'synthetic-claude-key');
    await blur(nextKey);
    await act(async () => {
      oldCatalog.resolve({ ok: true, models: ['STALE-MODEL'] });
      oldTest.resolve({
        ok: false,
        latencyMs: 1,
        baseUrl: '',
        error: 'STALE-FAILURE',
      });
    });
    expect(host.textContent).not.toContain('STALE-MODEL');
    expect(host.textContent).not.toContain('STALE-FAILURE');
    expect(host.textContent).toContain('settings.testOk');
  });
  it('cancels probes when navigating away from the provider step', async () => {
    api.llmTestConnection.mockReturnValue(new Promise(() => {}));
    const key = await wizard();
    await blur(key);
    await click('wizard.continue');
    expect(api.llmCancelProbe).toHaveBeenCalled();
    await click('wizard.back');
    expect(host.textContent).not.toContain('settings.testing');
  });
});
