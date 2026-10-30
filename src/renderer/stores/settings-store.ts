import { create } from 'zustand';
import type { AppSettings, CustomOpenAISettings, Language, Theme } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/types';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
  setTheme: (theme: Theme) => Promise<void>;
  setLlmProvider: (provider: string) => Promise<void>;
  setApiKey: (provider: string, key: string) => Promise<void>;
  setPlanApiKey: (provider: string, key: string) => Promise<void>;
  setApiAccessMode: (provider: string, mode: 'payg' | 'plan') => Promise<void>;
  setApiBaseUrlOverride: (provider: string, url: string) => Promise<void>;
  setModel: (provider: string, modelId: string) => Promise<void>;
  setOllamaModelInput: (value: string) => Promise<void>;
  setLlmRawDump: (on: boolean) => Promise<void>;
  setCustomOpenAI: (patch: Partial<CustomOpenAISettings>) => Promise<void>;
  /** 标记向导已走过(完成或跳过) — App 的首启检测据此不再拉人进向导。 */
  completeOnboarding: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  // Serialise persistence and compute each edit from the latest successful
  // snapshot. A slow key save must not overwrite a newer provider/mode edit.
  let tail: Promise<void> = Promise.resolve();
  const update = (edit: (settings: AppSettings) => AppSettings): Promise<void> => {
    const task = tail.then(async () => {
      const next = edit(get().settings);
      await window.opendeploy.saveSettings(next);
      set({ settings: next });
    });
    tail = task.catch(() => {});
    return task;
  };
  return {
    settings: DEFAULT_SETTINGS,
    loaded: false,
    load: async () => {
      const settings = await window.opendeploy.getSettings();
      set({ settings, loaded: true });
    },
    setLanguage: (language) => update((current) => ({ ...current, language })),
    setTheme: (theme) => update((current) => ({ ...current, theme })),
    setLlmProvider: (llmProvider) => update((current) => ({ ...current, llmProvider })),
    setApiKey: (provider, key) => update((current) => provider === 'custom-openai'
      ? { ...current, customOpenAI: { ...current.customOpenAI, apiKey: key } }
      : { ...current, apiKeys: { ...current.apiKeys, [provider]: key } }),
    setPlanApiKey: (provider, key) => update((current) => ({
      ...current, planApiKeys: { ...current.planApiKeys, [provider]: key },
    })),
    setApiAccessMode: (provider, mode) => update((current) => ({
      ...current, apiAccessMode: { ...current.apiAccessMode, [provider]: mode },
    })),
    setApiBaseUrlOverride: (provider, url) => update((current) => {
      const apiBaseUrlOverride = { ...current.apiBaseUrlOverride };
      if (url.trim()) apiBaseUrlOverride[provider] = url.trim();
      else delete apiBaseUrlOverride[provider];
      return { ...current, apiBaseUrlOverride };
    }),
    setModel: (provider, model) => update((current) => provider === 'custom-openai'
      ? { ...current, customOpenAI: { ...current.customOpenAI, model } }
      : { ...current, modelByProvider: { ...current.modelByProvider, [provider]: model } }),
    setOllamaModelInput: (ollamaModelInput) => update((current) => ({ ...current, ollamaModelInput })),
    setLlmRawDump: (llmRawDump) => update((current) => ({ ...current, llmRawDump })),
    setCustomOpenAI: (patch) => update((current) => ({
      ...current, customOpenAI: { ...current.customOpenAI, ...patch },
    })),
    completeOnboarding: () => update((current) => ({ ...current, onboardingDone: true })),
  };
});
