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
  /** 缓存从 /models|/api/tags 拉到的模型 id,供下拉合并展示。 */
  setFetchedModels: (providerId: string, ids: string[]) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    const settings = await window.opendeploy.getSettings();
    set({ settings, loaded: true });
  },

  setLanguage: async (language) => {
    const next = { ...get().settings, language };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setTheme: async (theme) => {
    const next = { ...get().settings, theme };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setLlmProvider: async (provider) => {
    const next = { ...get().settings, llmProvider: provider };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setApiKey: async (provider, key) => {
    const current = get().settings;
    if (provider === 'custom-openai') {
      const next = {
        ...current,
        customOpenAI: { ...(current.customOpenAI ?? {}), apiKey: key }
      };
      await window.opendeploy.saveSettings(next);
      set({ settings: next });
      return;
    }
    const apiKeys = { ...(current.apiKeys ?? {}), [provider]: key };
    const next = { ...current, apiKeys };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setPlanApiKey: async (provider, key) => {
    const current = get().settings;
    const planApiKeys = { ...(current.planApiKeys ?? {}), [provider]: key };
    const next = { ...current, planApiKeys };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setApiAccessMode: async (provider, mode) => {
    const current = get().settings;
    const apiAccessMode = { ...(current.apiAccessMode ?? {}), [provider]: mode };
    const next = { ...current, apiAccessMode };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setApiBaseUrlOverride: async (provider, url) => {
    const current = get().settings;
    const trimmed = url.trim();
    const apiBaseUrlOverride = { ...(current.apiBaseUrlOverride ?? {}) };
    if (trimmed === '') {
      delete apiBaseUrlOverride[provider];
    } else {
      apiBaseUrlOverride[provider] = trimmed;
    }
    const next = { ...current, apiBaseUrlOverride };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setModel: async (provider, modelId) => {
    const current = get().settings;
    if (provider === 'custom-openai') {
      const next = {
        ...current,
        customOpenAI: { ...(current.customOpenAI ?? {}), model: modelId }
      };
      await window.opendeploy.saveSettings(next);
      set({ settings: next });
      return;
    }
    const modelByProvider = { ...(current.modelByProvider ?? {}), [provider]: modelId };
    const next = { ...current, modelByProvider };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setOllamaModelInput: async (value) => {
    const next = { ...get().settings, ollamaModelInput: value };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setLlmRawDump: async (on) => {
    const next = { ...get().settings, llmRawDump: on };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setCustomOpenAI: async (patch) => {
    const current = get().settings;
    const next = {
      ...current,
      customOpenAI: { ...(current.customOpenAI ?? {}), ...patch }
    };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  completeOnboarding: async () => {
    const next = { ...get().settings, onboardingDone: true };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  },

  setFetchedModels: async (providerId, ids) => {
    const current = get().settings;
    const next = {
      ...current,
      fetchedModelsByProvider: {
        ...(current.fetchedModelsByProvider ?? {}),
        [providerId]: { ids, fetchedAt: Date.now() }
      }
    };
    await window.opendeploy.saveSettings(next);
    set({ settings: next });
  }
}));
