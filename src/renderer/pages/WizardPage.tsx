import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@renderer/stores/settings-store';
import { PROVIDERS, PROVIDER_BY_ID, resolveActiveModel, type LlmModel } from '@renderer/data/providers';
import { KeyInput } from '@renderer/components/KeyInput';
import { Icons } from '@renderer/components/icons';
import { LogoMark } from '@renderer/components/LogoMark';
import type { TestConnectionResult } from '@shared/types';

const WIZARD_PROVIDERS = PROVIDERS.filter((p) => p.id !== 'custom-openai');

interface WizardPageProps {
  /** Called after the user clicks "Finish" on the final step. */
  onFinish: () => void;
}

/**
 * WizardPage — 3-step onboarding wizard.
 *
 * Step 0 is a Linear-style minimalist hero (big logo + brand +
 * single-line tagline + primary CTA + one-line feature chips). The
 * stepper and `back` button only appear from Step 1 onward.
 *
 * Step 1 (provider) and Step 2 (done) keep the existing structure.
 */
export function WizardPage({ onFinish }: WizardPageProps) {
  const { t } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const [step, setStep] = useState(0);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [accessMode, setAccessMode] = useState<'payg' | 'plan'>('payg');
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [customModelId, setCustomModelId] = useState('');
  const [fetchedIds, setFetchedIds] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const lastProbedKey = useRef<string>('');
  const setLlmProvider = useSettingsStore((s) => s.setLlmProvider);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const setPlanApiKey = useSettingsStore((s) => s.setPlanApiKey);
  const setApiAccessMode = useSettingsStore((s) => s.setApiAccessMode);
  const setModel = useSettingsStore((s) => s.setModel);

  const selectedProviderObj = selectedProvider ? PROVIDER_BY_ID[selectedProvider] : undefined;

  // Reset model when provider switches: pick the recommended model of the new
  // provider so the dropdown is never empty. Ollama (free-form input) stays ''.
  useEffect(() => {
    if (!selectedProvider || selectedProvider === 'ollama') {
      setSelectedModelId('');
    } else {
      const m = resolveActiveModel(selectedProvider, undefined);
      setSelectedModelId(m?.id ?? '');
    }
    setCustomModelId('');
    setFetchedIds([]);
    setTestResult(null);
    lastProbedKey.current = '';
  }, [selectedProvider]);

  // Reset access mode when provider switches — a provider may not advertise
  // a plan endpoint at all, so always start at 'payg' (safe default).
  // Prefill from the saved bucket instead of clearing: the wizard can reappear
  // after a skip/reconfig, and making the user re-paste a stored key is churn.
  useEffect(() => {
    setAccessMode('payg');
    setApiKeyInput(selectedProvider ? settings.apiKeys?.[selectedProvider] ?? '' : '');
  }, [selectedProvider]);

  // key 输入框失焦 → 用刚输入的 key 拉模型目录 + 跑连通性测试(同一 key 只探测一次)。
  const probeWithKey = (): void => {
    const key = apiKeyInput.trim();
    if (!selectedProvider || !key) return;
    const probeKey = `${selectedProvider}|${accessMode}|${key}`;
    if (lastProbedKey.current === probeKey) return;
    lastProbedKey.current = probeKey;
    void (async () => {
      const res = await window.opendeploy.llmListModels({
        providerId: selectedProvider,
        apiKey: key,
        accessMode
      });
      if (res.ok && res.models && res.models.length > 0) setFetchedIds(res.models);
    })();
    void (async () => {
      const model = customModelId.trim() || selectedModelId;
      if (!model) return;
      setTesting(true);
      try {
        const res = await window.opendeploy.llmTestConnection({
          providerId: selectedProvider,
          apiKey: key,
          model,
          accessMode
        });
        setTestResult(res);
      } finally {
        setTesting(false);
      }
    })();
  };

  const effectiveModelId = (): string =>
    selectedProvider === 'ollama'
      ? (PROVIDER_BY_ID['ollama']?.modelInputDefault ?? '')
      : customModelId.trim() || selectedModelId;

  // 内置目录 + 已拉取 id (去重);纯拉取条目 label 就是模型 id。
  const wizardModels: LlmModel[] = selectedProviderObj
    ? [
        ...selectedProviderObj.models,
        ...fetchedIds
          .filter((id) => !selectedProviderObj.models.some((m) => m.id === id))
          .map((id) => ({ id, label: id, contextWindow: 128_000, maxOutput: 8_192, pricing: '—', hint: '' }))
      ]
    : [];

  // Stepper only covers the two "real" onboarding steps — Step 0 is a hero.
  const steps = [t('wizard.stepProvider'), t('wizard.stepDone')];
  const stepperIndex = step - 1; // -1 on step 0 = hidden

  const selectedProviderLabel =
    (selectedProvider && PROVIDER_BY_ID[selectedProvider]?.short) ?? '—';

  const handleFinish = async (): Promise<void> => {
    if (selectedProvider) {
      await setLlmProvider(selectedProvider);
      if (selectedProvider !== 'ollama' && apiKeyInput.trim()) {
        // Route the key into the correct bucket so future loads pick it up
        // when the same mode is active. Plan/payg keys are kept independent
        // (e.g. small users on payg can keep their sk-xxxx untouched after
        // experimenting with a plan tp-xxxx).
        if (accessMode === 'plan') {
          await setPlanApiKey(selectedProvider, apiKeyInput.trim());
        } else {
          await setApiKey(selectedProvider, apiKeyInput.trim());
        }
        await setApiAccessMode(selectedProvider, accessMode);
      }
      // 自定义模型名优先 — 用户显式输入的 id 直接生效。
      const modelToSave =
        selectedProvider !== 'ollama' && customModelId.trim()
          ? customModelId.trim()
          : selectedProvider !== 'ollama'
            ? selectedModelId
            : '';
      if (modelToSave) {
        await setModel(selectedProvider, modelToSave);
      }
    }
    onFinish();
  };

  const providerStepBlocked =
    !selectedProvider ||
    (selectedProvider !== 'ollama' && !apiKeyInput.trim());

  return (
    <div className="wizard">
      <div className="wiz-card">
        {step === 0 ? (
          <div className="wiz-hero">
            <div className="mark">
              <LogoMark size={80} variant="default" label={t('app.name')} />
            </div>
            <h1>{t('app.name')}</h1>
            <p className="tagline">{t('wizard.tagline')}</p>
            <button
              type="button"
              className="btn primary lg cta"
              onClick={() => setStep(1)}
            >
              {t('wizard.startCta')} →
            </button>
            <button
              type="button"
              className="btn"
              style={{ fontSize: 12, color: 'var(--muted)' }}
              onClick={onFinish}
            >
              {t('wizard.skip')}
            </button>
            <div className="wiz-chips">
              <span className="chip-item">
                {Icons.shield}
                {t('wizard.feat1Title')}
              </span>
              <span className="chip-dot">·</span>
              <span className="chip-item">
                {Icons.brain}
                {t('wizard.feat2Title')}
              </span>
              <span className="chip-dot">·</span>
              <span className="chip-item">
                {Icons.book}
                {t('wizard.feat3Title')}
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="wiz-stepper">
              {steps.map((s, i) => (
                <Fragment key={i}>
                  <span
                    className={`s ${i < stepperIndex ? 'done' : i === stepperIndex ? 'cur' : ''}`}
                  >
                    <span className="n">{i < stepperIndex ? '✓' : i + 1}</span>
                    {s}
                  </span>
                  {i < steps.length - 1 && <span className="dash" />}
                </Fragment>
              ))}
            </div>

            <div className="wiz-body">
              {step === 1 && (
                <>
                  <h3>{t('wizard.providerHeading')}</h3>
                  <div className="hint">{t('wizard.providerDesc')}</div>
                  <div
                    className="prov-grid"
                    style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}
                  >
                    {WIZARD_PROVIDERS.map((p) => {
                      const active = selectedProvider === p.id;
                      return (
                        <div
                          key={p.id}
                          className={`prov-card${active ? ' on' : ''}`}
                          onClick={() => setSelectedProvider(p.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedProvider(p.id);
                            }
                          }}
                        >
                          <div className="prov-title">
                            <span className={`prov-dot ${p.dot}`}>{p.letter}</span>
                            {p.label}
                            {p.recommended && (
                              <span
                                className="chip accent"
                                style={{ marginLeft: 'auto' }}
                              >
                                {t('settings.recommended')}
                              </span>
                            )}
                          </div>
                          <div className="prov-sub">{p.sub}</div>
                        </div>
                      );
                    })}
                  </div>
                  {selectedProvider && (
                    <div style={{ marginTop: 16 }}>
                      {selectedProvider === 'ollama' ? (
                        <div className="hint">{t('settings.ollamaNoKey')}</div>
                      ) : (
                        <>
                          {/* Access-mode toggle: only shown for providers that
                              actually publish a token-plan endpoint. Hiding it
                              for non-plan providers (DeepSeek/GPT/Claude/…)
                              avoids confusing 90 % of users with a control
                              they have no use for. */}
                          {selectedProviderObj?.tokenPlan && (
                            <div style={{ marginBottom: 12 }}>
                              <label
                                style={{
                                  display: 'block',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  marginBottom: 6
                                }}
                              >
                                {t('settings.accessMode.label')}
                              </label>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className={`btn${accessMode === 'payg' ? ' primary' : ''}`}
                                  onClick={() => {
                                    setAccessMode('payg');
                                    setApiKeyInput(
                                      selectedProvider
                                        ? settings.apiKeys?.[selectedProvider] ?? ''
                                        : ''
                                    );
                                  }}
                                >
                                  {t('settings.accessMode.payg')}
                                </button>
                                <button
                                  type="button"
                                  className={`btn${accessMode === 'plan' ? ' primary' : ''}`}
                                  onClick={() => {
                                    setAccessMode('plan');
                                    setApiKeyInput(
                                      selectedProvider
                                        ? settings.planApiKeys?.[selectedProvider] ?? ''
                                        : ''
                                    );
                                  }}
                                >
                                  {t('settings.accessMode.plan')}
                                </button>
                              </div>
                              <div
                                className="hint"
                                style={{ marginTop: 6, fontSize: 12 }}
                              >
                                {accessMode === 'plan'
                                  ? t('settings.accessMode.planHint')
                                  : t('settings.accessMode.paygHint')}
                                {accessMode === 'plan' && selectedProviderObj.tokenPlan.docsUrl && (
                                  <>
                                    {'  '}
                                    <a
                                      href={selectedProviderObj.tokenPlan.docsUrl}
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
                          )}
                          <label
                            style={{
                              display: 'block',
                              fontSize: 12,
                              fontWeight: 600,
                              marginBottom: 6
                            }}
                          >
                            {accessMode === 'plan'
                              ? t('settings.planApiKey')
                              : t('settings.apiKey')}
                          </label>
                          <KeyInput
                            value={apiKeyInput}
                            onChange={setApiKeyInput}
                            onBlur={probeWithKey}
                            placeholder={
                              accessMode === 'plan'
                                ? t('settings.planApiKeyPlaceholder')
                                : t('settings.apiKeyPlaceholder')
                            }
                            inputStyle={{ width: '100%', flex: '1 1 auto' }}
                            containerStyle={{ width: '100%' }}
                          />
                          {(testing || testResult) && (
                            <div
                              className="small"
                              style={{
                                marginTop: 6,
                                lineHeight: 1.5,
                                color: testResult?.ok
                                  ? 'var(--ok, #2e7d32)'
                                  : 'var(--danger, #c62828)',
                                wordBreak: 'break-all'
                              }}
                            >
                              {testing
                                ? t('settings.testing')
                                : testResult?.ok
                                  ? t('settings.testOk', { ms: testResult.latencyMs })
                                  : testResult
                                    ? `${t('settings.testFailed')}：${testResult.error ?? ''}`
                                    : ''}
                            </div>
                          )}
                          {selectedProviderObj && wizardModels.length > 0 && (
                            <div style={{ marginTop: 12 }}>
                              <label
                                style={{
                                  display: 'block',
                                  fontSize: 12,
                                  fontWeight: 600,
                                  marginBottom: 6
                                }}
                              >
                                {t('settings.model')}
                              </label>
                              <select
                                value={
                                  wizardModels.some((m) => m.id === selectedModelId)
                                    ? selectedModelId
                                    : (selectedProviderObj.models.find((m) => m.recommended) ?? selectedProviderObj.models[0])?.id ?? ''
                                }
                                onChange={(e) => {
                                  setSelectedModelId(e.target.value);
                                  setCustomModelId('');
                                }}
                                style={{
                                  width: '100%',
                                  padding: '8px 12px',
                                  border: '1px solid var(--border)',
                                  borderRadius: 6,
                                  background: 'var(--surface)',
                                  color: 'var(--ink)',
                                  fontSize: 13
                                }}
                              >
                                {wizardModels.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.label}{m.recommended ? ` (${t('settings.recommendedShort')})` : ''}{m.hint ? ` — ${m.hint}` : ''}
                                  </option>
                                ))}
                              </select>
                              <div className="hint" style={{ marginTop: 6, fontSize: 12 }}>
                                {t('settings.customModelHint')}
                              </div>
                              <input
                                type="text"
                                value={customModelId}
                                onChange={(e) => setCustomModelId(e.target.value)}
                                placeholder={t('settings.customModelLabel')}
                                style={{
                                  width: '100%',
                                  marginTop: 6,
                                  padding: '8px 12px',
                                  border: '1px solid var(--border)',
                                  borderRadius: 6,
                                  background: 'var(--surface)',
                                  color: 'var(--ink)',
                                  fontSize: 13,
                                  fontFamily: 'var(--font-mono)'
                                }}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

              {step === 2 && (
                <>
                  <h3>{t('wizard.doneHeading')}</h3>
                  <div className="hint">{t('wizard.doneDesc')}</div>
                  <div className="card" style={{ margin: 0, padding: 14 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 8
                      }}
                    >
                      <span className="muted small">LLM</span>
                      <span className="mono small">
                        {selectedProviderLabel}
                        {selectedProviderObj && customModelId.trim() && ` · ${customModelId.trim()}`}
                        {selectedProviderObj && !customModelId.trim() && selectedModelId && (() => {
                          const m = selectedProviderObj.models.find((x) => x.id === selectedModelId);
                          return ` · ${m ? m.label : selectedModelId}`;
                        })()}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: 8
                      }}
                    >
                      <span className="muted small">{t('wizard.skillLib')}</span>
                      <span className="mono small">@built-in · 2026-04-19</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="muted small">{t('wizard.next')}</span>
                      <span
                        className="mono small"
                        style={{ color: 'var(--accent-deep)' }}
                      >
                        {t('wizard.nextAction')}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="wiz-foot">
              {/* Back from Step 1 intentionally returns to the Step 0 hero. */}
              <button
                className="btn"
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                {t('wizard.back')}
              </button>
              <span className="wiz-progress">
                {step} / {steps.length}
              </span>
              {step === 1 && (
                <button
                  className="btn"
                  type="button"
                  style={{ color: 'var(--muted)', fontSize: 12 }}
                  onClick={onFinish}
                >
                  {t('wizard.skip')}
                </button>
              )}
              {step < steps.length ? (
                <button
                  className="btn primary lg"
                  type="button"
                  disabled={step === 1 && providerStepBlocked}
                  onClick={() => setStep((s) => Math.min(steps.length, s + 1))}
                >
                  {t('wizard.continue')}
                </button>
              ) : (
                <button
                  className="btn accent lg"
                  type="button"
                  onClick={() => {
                    void handleFinish();
                  }}
                >
                  {t('wizard.finish')} →
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default WizardPage;
