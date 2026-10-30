import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore } from '../../src/renderer/stores/settings-store';
import { DEFAULT_SETTINGS } from '@shared/types';

describe('settings store — model selection', () => {
  let saveSettingsMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    saveSettingsMock = vi.fn().mockResolvedValue(undefined);
    // Stub window.opendeploy on globalThis (renderer code reads window.*)
    (globalThis as unknown as { window: unknown }).window = {
      opendeploy: {
        saveSettings: saveSettingsMock,
        getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS)
      }
    };
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, loaded: false });
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('setModel persists modelByProvider[providerId]', async () => {
    await useSettingsStore.getState().setModel('deepseek', 'deepseek-v4-pro');
    const s = useSettingsStore.getState().settings;
    expect(s.modelByProvider).toEqual({ deepseek: 'deepseek-v4-pro' });
    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelByProvider: { deepseek: 'deepseek-v4-pro' } })
    );
  });

  it('setModel merges across multiple providers', async () => {
    await useSettingsStore.getState().setModel('deepseek', 'deepseek-v4-pro');
    await useSettingsStore.getState().setModel('claude', 'claude-opus-4-7');
    const s = useSettingsStore.getState().settings;
    expect(s.modelByProvider).toEqual({
      deepseek: 'deepseek-v4-pro',
      claude: 'claude-opus-4-7'
    });
  });

  it('setModel overwrites previous selection for same provider', async () => {
    await useSettingsStore.getState().setModel('deepseek', 'deepseek-v4-flash');
    await useSettingsStore.getState().setModel('deepseek', 'deepseek-v4-pro');
    const s = useSettingsStore.getState().settings;
    expect(s.modelByProvider).toEqual({ deepseek: 'deepseek-v4-pro' });
  });

  it('setOllamaModelInput persists value', async () => {
    await useSettingsStore.getState().setOllamaModelInput('llama3.1:70b');
    expect(useSettingsStore.getState().settings.ollamaModelInput).toBe('llama3.1:70b');
    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ ollamaModelInput: 'llama3.1:70b' })
    );
  });

  it('preserves both edits when a key save overlaps a provider change', async () => {
    let finish!: () => void;
    saveSettingsMock.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const keySave = useSettingsStore.getState().setApiKey('deepseek', 'synthetic-new-key');
    const providerSave = useSettingsStore.getState().setLlmProvider('claude');
    await Promise.resolve();
    finish();
    await Promise.all([keySave, providerSave]);
    const settings = useSettingsStore.getState().settings;
    expect(settings.llmProvider).toBe('claude');
    expect(settings.apiKeys?.deepseek).toBe('synthetic-new-key');
    expect(saveSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({
      llmProvider: 'claude', apiKeys: { deepseek: 'synthetic-new-key' },
    }));
  });

  it('allows another edit after a failed save without persisting the failed edit', async () => {
    saveSettingsMock.mockRejectedValueOnce(new Error('synthetic persistence failure'));
    await expect(useSettingsStore.getState().setApiKey('deepseek', 'unsaved-key')).rejects.toThrow();
    await useSettingsStore.getState().setLlmProvider('claude');
    expect(useSettingsStore.getState().settings.llmProvider).toBe('claude');
    expect(useSettingsStore.getState().settings.apiKeys?.deepseek).not.toBe('unsaved-key');
  });
});
