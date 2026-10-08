import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@renderer/i18n';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { PROVIDERS, PROVIDER_BY_ID, resolveActiveModel, type LlmProvider, type LlmModel } from '@renderer/data/providers';
import { KeyInput } from '@renderer/components/KeyInput';
import type { Language, Theme, TestConnectionResult } from '@shared/types';

const LANGUAGES: { value: Language; labelKey: string }[] = [
  { value: 'zh-CN', labelKey: 'zh-CN' },
  { value: 'en-US', labelKey: 'en-US' }
];

const THEMES: { value: Theme; labelKey: string }[] = [
  { value: 'light', labelKey: 'settings.themeLight' },
  { value: 'dark', labelKey: 'settings.themeDark' },
  { value: 'system', labelKey: 'settings.themeSystem' }
];

type SettingsSection = 'appearance' | 'llm' | 'about';

/**
 * SettingsPage — settings surface of OpenDeploy.
 *
 * Restructured from a flat long page to a 2-column layout with a left
 * sub-nav. Sections:
 *
 * - Appearance: language + theme.
 * - LLM Provider: 11-card provider grid + API Key input (Ollama is local
 *   and skips the input).
 * - About: version, license, source link, copyright.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const [section, setSection] = useState<SettingsSection>('appearance');

  const navItems: { key: SettingsSection; label: string }[] = [
    { key: 'appearance', label: t('settings.sectionAppearance') },
    { key: 'llm', label: t('settings.sectionLlm') },
    { key: 'about', label: t('settings.sectionAbout') }
  ];

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left sub-nav */}
      <nav
        style={{
          width: 200,
          borderRight: '1px solid var(--border)',
          padding: '20px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          overflowY: 'auto'
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, margin: '0 4px 16px' }}>
          {t('settings.title')}
        </div>
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSection(item.key)}
            style={{
              padding: '8px 12px',
              textAlign: 'left',
              border: 'none',
              borderRadius: 6,
              background:
                section === item.key ? 'var(--surface-hover)' : 'transparent',
              color: section === item.key ? 'var(--ink)' : 'var(--muted)',
              fontWeight: section === item.key ? 600 : 400,
              cursor: 'pointer'
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Right content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
        {section === 'appearance' && <AppearanceSection />}
        {section === 'llm' && <LlmSection />}
        {section === 'about' && <AboutSection />}
      </div>
    </div>
  );
}

/**
 * AppearanceSection — language + theme switcher.
 */
function AppearanceSection() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const setTheme = useSettingsStore((s) => s.setTheme);

  const handleLanguageChange = async (lang: Language): Promise<void> => {
    await setLanguage(lang);
    await i18n.changeLanguage(lang);
  };

  const handleThemeChange = async (theme: Theme): Promise<void> => {
    await setTheme(theme);
  };

  return (
    <section>
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.appearance')}</h3>
      <div className="setting-row">
        <div>
          <div className="lbl">{t('settings.language')}</div>
        </div>
        <div className="ctl" style={{ display: 'flex', gap: 6 }}>
          {LANGUAGES.map((l) => (
            <button
              key={l.value}
              type="button"
              className={`btn${settings.language === l.value ? ' primary' : ''}`}
              onClick={() => {
                void handleLanguageChange(l.value);
              }}
            >
              {l.value === 'zh-CN' ? '中文' : 'English'}
            </button>
          ))}
        </div>
      </div>
      <div className="setting-row" style={{ borderBottom: 'none' }}>
        <div>
          <div className="lbl">{t('settings.theme')}</div>
        </div>
        <div className="ctl" style={{ display: 'flex', gap: 6 }}>
          {THEMES.map((th) => (
            <button
              key={th.value}
              type="button"
              className={`btn${settings.theme === th.value ? ' primary' : ''}`}
              onClick={() => {
                void handleThemeChange(th.value);
              }}
            >
              {t(th.labelKey)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * LlmSection — 11-card provider grid + API Key input + Save.
 */
function LlmSection() {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const setLlmProvider = useSettingsStore((s) => s.setLlmProvider);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const setPlanApiKey = useSettingsStore((s) => s.setPlanApiKey);
  const setApiAccessMode = useSettingsStore((s) => s.setApiAccessMode);
  const setApiBaseUrlOverride = useSettingsStore((s) => s.setApiBaseUrlOverride);
  const setModel = useSettingsStore((s) => s.setModel);
  const setOllamaModelInput = useSettingsStore((s) => s.setOllamaModelInput);

  const initialProviderId = settings.llmProvider ?? 'deepseek';
  const [selectedProviderId, setSelectedProviderId] =
    useState<string>(initialProviderId);
  const provider: LlmProvider | undefined = PROVIDER_BY_ID[selectedProviderId];

  const [apiKeyInput, setApiKeyInput] = useState<string>(
    settings.apiKeys?.[initialProviderId] ?? ''
  );
  const [planKeyInput, setPlanKeyInput] = useState<string>(
    settings.planApiKeys?.[initialProviderId] ?? ''
  );
  const [baseUrlInput, setBaseUrlInput] = useState<string>(
    settings.apiBaseUrlOverride?.[initialProviderId] ?? ''
  );
  const activeMode: 'payg' | 'plan' =
    settings.apiAccessMode?.[selectedProviderId] ?? 'payg';
  const [saved, setSaved] = useState(false);

  const [selectedModelId, setSelectedModelId] = useState<string>(
    () => resolveActiveModel(selectedProviderId, settings.modelByProvider)?.id ?? ''
  );
  const activeModelMeta: LlmModel | null = resolveActiveModel(
    selectedProviderId,
    settings.modelByProvider
  );

  const [ollamaInput, setOllamaInput] = useState<string>(
    () => settings.ollamaModelInput ?? PROVIDER_BY_ID['ollama']?.modelInputDefault ?? ''
  );

  // ─── 自定义模型名 — stored id 不在内置目录时回显在这里 ───
  const [customModelInput, setCustomModelInput] = useState<string>(() => {
    const stored = settings.modelByProvider?.[initialProviderId];
    const inCatalog = PROVIDER_BY_ID[initialProviderId]?.models.some((m) => m.id === stored);
    return stored && !inCatalog ? stored : '';
  });

  // ─── 连通性测试 ───
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  // Re-resolve when provider changes (selectedProviderId mutates as user clicks cards)
  useEffect(() => {
    const m = resolveActiveModel(selectedProviderId, settings.modelByProvider);
    setSelectedModelId(m?.id ?? '');
    const stored = settings.modelByProvider?.[selectedProviderId];
    const inCatalog = PROVIDER_BY_ID[selectedProviderId]?.models.some((mm) => mm.id === stored);
    setCustomModelInput(stored && !inCatalog ? stored : '');
    setTestResult(null);
  }, [selectedProviderId, settings.modelByProvider]);

  // ─── 模型目录自动获取 ───
  const setFetchedModels = useSettingsStore((s) => s.setFetchedModels);
  const fetchingRef = useRef<Set<string>>(new Set());
  const fetchCatalog = useCallback(async (providerId: string, mode: 'payg' | 'plan'): Promise<void> => {
    if (fetchingRef.current.has(providerId)) return;
    const target = PROVIDER_BY_ID[providerId];
    if (!target) return;
    const key =
      mode === 'plan'
        ? settings.planApiKeys?.[providerId]
        : settings.apiKeys?.[providerId];
    if (providerId !== 'ollama' && !key) return;
    const baseUrlOverride =
      providerId === 'custom-openai'
        ? settings.customOpenAI?.baseUrl
        : settings.apiBaseUrlOverride?.[providerId];
    if (providerId === 'custom-openai' && !baseUrlOverride) return;
    fetchingRef.current.add(providerId);
    try {
      const res = await window.opendeploy.llmListModels({
        providerId,
        apiKey: key,
        accessMode: mode,
        ...(baseUrlOverride ? { baseUrlOverride } : {})
      });
      if (res.ok && res.models && res.models.length > 0) {
        await setFetchedModels(providerId, res.models);
      }
    } catch {
      // 静默 — 拉不到就用内置目录,不打扰用户
    } finally {
      fetchingRef.current.delete(providerId);
    }
  }, [settings.apiKeys, settings.planApiKeys, settings.customOpenAI, settings.apiBaseUrlOverride, setFetchedModels]);

  // 选中供应商 / 切计费模式 / key 变化时自动拉一次;有缓存也后台刷新。
  useEffect(() => {
    void fetchCatalog(selectedProviderId, activeMode);
  }, [selectedProviderId, activeMode, fetchCatalog]);

  // 下拉选项 = 内置目录 + 已拉取 id (去重);纯拉取的条目 label 就是模型 id。
  const fetchedIds = settings.fetchedModelsByProvider?.[selectedProviderId]?.ids ?? [];
  const mergedModels: LlmModel[] = [
    ...(provider?.models ?? []),
    ...fetchedIds
      .filter((id) => !(provider?.models ?? []).some((m) => m.id === id))
      .map((id) => ({ id, label: id, contextWindow: 128_000, maxOutput: 8_192, pricing: '—', hint: '' }))
  ];
  // stored 自定义模型不在 mergedModels 时,select 显示 recommended (实际请求仍用 stored)。
  const selectValue = mergedModels.some((m) => m.id === selectedModelId)
    ? selectedModelId
    : (provider?.models.find((m) => m.recommended) ?? provider?.models[0])?.id ?? '';

  const handleModelChange = async (id: string): Promise<void> => {
    setSelectedModelId(id);
    setCustomModelInput('');
    setSaved(false);
    await setModel(selectedProviderId, id);
  };
  const handleCustomModelBlur = async (): Promise<void> => {
    const trimmed = customModelInput.trim();
    if (!trimmed) return; // 清空 = 放弃自定义,保持当前选择
    if (trimmed === settings.modelByProvider?.[selectedProviderId]) return;
    setSelectedModelId(trimmed);
    await setModel(selectedProviderId, trimmed);
  };
  const handleOllamaInputBlur = async (): Promise<void> => {
    const trimmed = ollamaInput.trim();
    if (trimmed) {
      await setOllamaModelInput(trimmed);
      return;
    }
    // Empty input → snap back to default so user sees what will actually be sent.
    const fallback = PROVIDER_BY_ID['ollama']?.modelInputDefault ?? '';
    setOllamaInput(fallback);
    await setOllamaModelInput(fallback);
  };

  const effectiveModelId = (): string => {
    if (isOllama) return ollamaInput.trim() || PROVIDER_BY_ID['ollama']?.modelInputDefault || '';
    return customModelInput.trim() || selectedModelId || '';
  };

  const runTestConnection = async (): Promise<void> => {
    const model = effectiveModelId();
    if (!model) {
      setTestResult({ ok: false, latencyMs: 0, baseUrl: '', error: t('settings.testNoModel') });
      return;
    }
    setTestResult(null);
    setTesting(true);
    try {
      const key =
        activeMode === 'plan'
          ? settings.planApiKeys?.[selectedProviderId]
          : settings.apiKeys?.[selectedProviderId];
      const baseUrlOverride =
        selectedProviderId === 'custom-openai'
          ? settings.customOpenAI?.baseUrl
          : settings.apiBaseUrlOverride?.[selectedProviderId];
      const res = await window.opendeploy.llmTestConnection({
        providerId: selectedProviderId,
        apiKey: key,
        model,
        accessMode: activeMode,
        ...(baseUrlOverride ? { baseUrlOverride } : {})
      });
      setTestResult(res);
    } finally {
      setTesting(false);
    }
  };

  const handleProviderSelect = async (provider: LlmProvider): Promise<void> => {
    setSelectedProviderId(provider.id);
    setApiKeyInput(settings.apiKeys?.[provider.id] ?? '');
    setPlanKeyInput(settings.planApiKeys?.[provider.id] ?? '');
    setBaseUrlInput(settings.apiBaseUrlOverride?.[provider.id] ?? '');
    setSaved(false);
    await setLlmProvider(provider.id);
  };

  const handleSavePayg = async (): Promise<void> => {
    await setApiKey(selectedProviderId, apiKeyInput);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
    void runTestConnection();
  };

  const handleSavePlan = async (): Promise<void> => {
    await setPlanApiKey(selectedProviderId, planKeyInput);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
    void runTestConnection();
  };

  const handleModeChange = async (mode: 'payg' | 'plan'): Promise<void> => {
    await setApiAccessMode(selectedProviderId, mode);
  };

  const handleSaveBaseUrl = async (): Promise<void> => {
    await setApiBaseUrlOverride(selectedProviderId, baseUrlInput);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const handleResetBaseUrl = async (): Promise<void> => {
    setBaseUrlInput('');
    await setApiBaseUrlOverride(selectedProviderId, '');
  };

  const isOllama = selectedProviderId === 'ollama';

  // URL 字段的默认值随计费模式切换(豆包/千问/Kimi/MiMo 的包月端点不同)。
  const defaultBaseUrl = (): string => {
    if (!provider) return '';
    if (activeMode === 'plan' && provider.tokenPlan?.baseUrl) return provider.tokenPlan.baseUrl;
    return provider.baseUrl || '';
  };
  const effectiveBaseUrl = (): string =>
    settings.apiBaseUrlOverride?.[selectedProviderId] || defaultBaseUrl() || '—';

  return (
    <>
      <section style={{ marginBottom: 32 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.llmSection')}</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          {t('settings.llmSectionDesc')}
        </p>
        <div className="prov-grid">
          {PROVIDERS.map((p) => {
            const active = selectedProviderId === p.id;
            return (
              <div
                key={p.id}
                className={`prov-card${active ? ' on' : ''}`}
                onClick={() => {
                  void handleProviderSelect(p);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void handleProviderSelect(p);
                  }
                }}
              >
                <div className="prov-title">
                  <span className={`prov-dot ${p.dot}`}>{p.letter}</span>
                  {p.label}
                  {p.recommended && !active && (
                    <span className="chip" style={{ marginLeft: 'auto', fontSize: 10 }}>
                      {t('settings.recommended')}
                    </span>
                  )}
                  {active && (
                    <span className="chip accent" style={{ marginLeft: 'auto' }}>
                      active
                    </span>
                  )}
                </div>
                <div className="prov-sub">{p.sub}</div>
                <div className="prov-row">
                  <span>
                    {p.id === 'ollama'
                      ? t('settings.customModel')
                      : t('settings.modelCount', { count: p.models.length })}
                  </span>
                  <span
                    className={`chip${p.region === 'Local' ? ' good' : p.region === 'CN' ? ' accent' : ''}`}
                    style={{ marginLeft: 'auto', fontSize: 10 }}
                  >
                    {t(`settings.regions.${p.region}`)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {!isOllama && provider && provider.models.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.model')}</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{t('settings.modelHint')}</p>
          <div className="setting-row" style={{ borderBottom: 'none', alignItems: 'flex-start' }}>
            <div>
              <div className="lbl">{provider.label}</div>
            </div>
            <div className="ctl" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select
                value={selectValue}
                onChange={(e) => { void handleModelChange(e.target.value); }}
                style={{ minWidth: 280, padding: '6px 8px' }}
              >
                {mergedModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.recommended ? ` (${t('settings.recommendedShort')})` : ''}{m.hint ? ` — ${m.hint}` : ''}
                  </option>
                ))}
              </select>
              {activeModelMeta && (
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
                  {t('settings.contextLabel')}: {(activeModelMeta.contextWindow / 1000).toFixed(0)}K ·{' '}
                  {t('settings.maxOutputLabel')}: {(activeModelMeta.maxOutput / 1000).toFixed(1)}K ·{' '}
                  {t('settings.priceLabel')}: {activeModelMeta.pricing}
                </div>
              )}
              <div>
                <div className="muted small" style={{ marginBottom: 4 }}>{t('settings.customModelHint')}</div>
                <input
                  type="text"
                  value={customModelInput}
                  onChange={(e) => { setCustomModelInput(e.target.value); setSaved(false); }}
                  onBlur={() => { void handleCustomModelBlur(); }}
                  placeholder={t('settings.customModelLabel')}
                  style={{ minWidth: 280, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      {isOllama && (
        <section style={{ marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.model')}</h3>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{t('settings.modelOllamaHint')}</p>
          <div className="setting-row" style={{ borderBottom: 'none' }}>
            <div><div className="lbl">{t('settings.model')}</div></div>
            <div className="ctl">
              <input
                type="text"
                value={ollamaInput}
                onChange={(e) => setOllamaInput(e.target.value)}
                onBlur={() => { void handleOllamaInputBlur(); }}
                placeholder={t('settings.modelOllamaPlaceholder')}
                style={{ minWidth: 280 }}
                list="ollama-model-list"
              />
              <datalist id="ollama-model-list">
                {(settings.fetchedModelsByProvider?.['ollama']?.ids ?? []).map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            </div>
          </div>
        </section>
      )}

      <section>
        <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.apiKeySection')}</h3>
        {isOllama ? (
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            {t('settings.ollamaNoKey')}
          </p>
        ) : (
          <>
            {/* Mode toggle — only render when this provider publishes a plan
                endpoint. For everyone else (DeepSeek/GPT/Claude/…) we keep
                the page lean and never surface the concept. */}
            {provider?.tokenPlan && (
              <div className="setting-row">
                <div>
                  <div className="lbl">{t('settings.accessMode.label')}</div>
                  <div className="muted small" style={{ marginTop: 4, lineHeight: 1.5 }}>
                    {activeMode === 'plan'
                      ? t('settings.accessMode.planHint')
                      : t('settings.accessMode.paygHint')}
                    {activeMode === 'plan' && provider.tokenPlan.docsUrl && (
                      <>
                        {'  '}
                        <a
                          href={provider.tokenPlan.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--accent-deep)' }}
                        >
                          {t('settings.accessMode.planDocsLink')}
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <div className="ctl" style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className={`btn${activeMode === 'payg' ? ' primary' : ''}`}
                    onClick={() => {
                      void handleModeChange('payg');
                    }}
                  >
                    {t('settings.accessMode.payg')}
                  </button>
                  <button
                    type="button"
                    className={`btn${activeMode === 'plan' ? ' primary' : ''}`}
                    onClick={() => {
                      void handleModeChange('plan');
                    }}
                  >
                    {t('settings.accessMode.plan')}
                  </button>
                </div>
              </div>
            )}

            {/* Pay-as-you-go key row — always shown for non-Ollama providers. */}
            <div className="setting-row">
              <div>
                <div className="lbl">
                  {t('settings.apiKey')} ({selectedProviderId})
                  {provider?.tokenPlan && activeMode === 'payg' && (
                    <span className="chip accent" style={{ marginLeft: 8, fontSize: 10 }}>
                      active
                    </span>
                  )}
                </div>
              </div>
              <div className="ctl" style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 340 }}>
                <KeyInput
                  value={apiKeyInput}
                  onChange={(v) => { setApiKeyInput(v); setSaved(false); }}
                  placeholder={
                    provider?.tokenPlan
                      ? t('settings.paygApiKeyPlaceholder')
                      : t('settings.apiKeyPlaceholder')
                  }
                  inputStyle={{ minWidth: 0, flex: 1 }}
                  containerStyle={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn primary lg"
                  onClick={() => {
                    void handleSavePayg();
                  }}
                >
                  {t('settings.save')}
                </button>
              </div>
            </div>

            {/* Plan key row — only when this provider has a plan endpoint.
                Keeping both keys editable side-by-side (instead of swapping
                in place when mode changes) lets users keep both buckets
                filled and flip the mode toggle without re-pasting keys. */}
            {provider?.tokenPlan && (
              <div className="setting-row">
                <div>
                  <div className="lbl">
                    {t('settings.planApiKey')} ({selectedProviderId})
                    {activeMode === 'plan' && (
                      <span className="chip accent" style={{ marginLeft: 8, fontSize: 10 }}>
                        active
                      </span>
                    )}
                  </div>
                  {provider.tokenPlan.keyPrefix &&
                    planKeyInput.trim() !== '' &&
                    !planKeyInput.trim().startsWith(provider.tokenPlan.keyPrefix) && (
                      <div className="muted small" style={{ marginTop: 4, color: 'var(--warn, #b58900)' }}>
                        {t('settings.planKeyMismatchHint', { prefix: provider.tokenPlan.keyPrefix })}
                      </div>
                    )}
                </div>
                <div className="ctl" style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 340 }}>
                  <KeyInput
                    value={planKeyInput}
                    onChange={(v) => { setPlanKeyInput(v); setSaved(false); }}
                    placeholder={t('settings.planApiKeyPlaceholder')}
                    inputStyle={{ minWidth: 0, flex: 1 }}
                    containerStyle={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn primary lg"
                    onClick={() => {
                      void handleSavePlan();
                    }}
                  >
                    {t('settings.save')}
                  </button>
                </div>
              </div>
            )}

            {saved && (
              <div style={{ marginTop: 6 }}>
                <span className="chip good">{t('settings.saved')}</span>
              </div>
            )}

            {/* Connectivity probe — tiny real request through the same
                endpoint resolution the chat path uses. Auto-runs after a
                key save; the button re-runs it any time. */}
            <div className="setting-row" style={{ borderBottom: 'none', alignItems: 'flex-start' }}>
              <div>
                <div className="lbl">{t('settings.testConnection')}</div>
                {testResult && (
                  <div
                    className="small"
                    style={{
                      marginTop: 4,
                      lineHeight: 1.5,
                      color: testResult.ok ? 'var(--ok, #2e7d32)' : 'var(--danger, #c62828)',
                      wordBreak: 'break-all'
                    }}
                  >
                    {testResult.ok
                      ? t('settings.testOk', { ms: testResult.latencyMs })
                      : `${t('settings.testFailed')}：${testResult.error ?? ''}`}
                    {testResult.baseUrl ? ` · ${testResult.baseUrl}` : ''}
                  </div>
                )}
              </div>
              <div className="ctl">
                <button
                  type="button"
                  className="btn"
                  disabled={testing}
                  onClick={() => {
                    void runTestConnection();
                  }}
                >
                  {testing ? t('settings.testing') : t('settings.testConnection')}
                </button>
              </div>
            </div>

            {/* API base URL — always visible, editable. Empty = keep the
                default (placeholder shows it); filled = hit this URL directly
                (apiBaseUrlOverride, highest priority in main's routing). */}
            <div className="setting-row" style={{ borderBottom: 'none', alignItems: 'flex-start' }}>
              <div>
                <div className="lbl">{t('settings.baseUrlLabel')}</div>
                <div className="muted small" style={{ marginTop: 4, lineHeight: 1.5 }}>
                  {t('settings.baseUrlHint')}
                </div>
                <div className="muted small mono" style={{ marginTop: 4, wordBreak: 'break-all' }}>
                  {t('settings.baseUrlEffective', { url: effectiveBaseUrl() })}
                </div>
              </div>
              <div className="ctl" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  value={baseUrlInput}
                  onChange={(e) => {
                    setBaseUrlInput(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={defaultBaseUrl()}
                  style={{ minWidth: 320, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    void handleSaveBaseUrl();
                  }}
                >
                  {t('settings.save')}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void handleResetBaseUrl();
                  }}
                >
                  {t('settings.resetDefault')}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}

/**
 * AboutSection — version, license, source, copyright.
 */
function AboutSection() {
  const { t } = useTranslation();
  return (
    <section>
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{t('settings.sectionAbout')}</h3>
      <div className="setting-row">
        <div>
          <div className="lbl">{t('settings.aboutVersion')}</div>
        </div>
        <div className="ctl">
          <span className="mono small">v{__APP_VERSION__}</span>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <div className="lbl">{t('settings.aboutSupportedErp')}</div>
        </div>
        <div className="ctl">
          <span className="small">{t('settings.aboutSupportedErpValue')}</span>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <div className="lbl">{t('settings.aboutLicense')}</div>
        </div>
        <div className="ctl">
          <span className="mono small">MIT</span>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <div className="lbl">{t('settings.aboutSource')}</div>
        </div>
        <div className="ctl">
          <a
            href="https://github.com/yourname/opendeploy"
            target="_blank"
            rel="noreferrer"
            className="mono small"
            style={{ color: 'var(--accent-deep)' }}
          >
            github.com/yourname/opendeploy
          </a>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <div className="lbl">{t('settings.aboutCopyright')}</div>
        </div>
      </div>

      <h3 style={{ margin: '24px 0 4px', fontSize: 16 }}>{t('settings.diagnosticsHeader')}</h3>
      <RawDumpRow />
    </section>
  );
}

function RawDumpRow(): React.ReactElement {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const setLlmRawDump = useSettingsStore((s) => s.setLlmRawDump);
  const enabled = settings.llmRawDump !== false;
  return (
    <div className="setting-row" style={{ borderBottom: 'none' }}>
      <div style={{ flex: 1 }}>
        <div className="lbl">{t('settings.rawDumpLabel')}</div>
        <div className="muted small" style={{ marginTop: 4, lineHeight: 1.5 }}>
          {t('settings.rawDumpDescription')}
        </div>
      </div>
      <div className="ctl">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              void setLlmRawDump(e.target.checked);
            }}
          />
          {enabled ? t('settings.rawDumpOn') : t('settings.rawDumpOff')}
        </label>
      </div>
    </div>
  );
}

export default SettingsPage;
