import type {
  AppSettings,
  IpcApi,
  LlmProviderProbeRequest,
  TestConnectionResult,
} from '@shared/types';
import { PROVIDER_BY_ID, resolveActiveModel } from '../data/providers';

export type ProbeConfig = Readonly<
  Required<
    Pick<
      LlmProviderProbeRequest,
      'providerId' | 'apiKey' | 'model' | 'accessMode' | 'baseUrlOverride'
    >
  >
>;
type Transport = Pick<
  IpcApi,
  'llmListModels' | 'llmTestConnection' | 'llmCancelProbe'
>;
type Kind = 'catalog' | 'connection';
type View = {
  testing: boolean;
  result: TestConnectionResult | null;
  models: string[];
};
const emptyView = (): View => ({ testing: false, result: null, models: [] });

export function probeConfig(
  settings: AppSettings,
  providerId: string,
  mode: 'payg' | 'plan',
  draft: Partial<
    Pick<ProbeConfig, 'apiKey' | 'model' | 'baseUrlOverride'>
  > = {},
): ProbeConfig {
  const provider = PROVIDER_BY_ID[providerId];
  const custom = providerId === 'custom-openai';
  return Object.freeze({
    providerId,
    accessMode: mode,
    apiKey: (
      draft.apiKey ??
      (custom
        ? settings.customOpenAI?.apiKey
        : mode === 'plan'
          ? settings.planApiKeys?.[providerId]
          : settings.apiKeys?.[providerId]) ??
      ''
    ).trim(),
    model: (
      draft.model ??
      (custom
        ? settings.customOpenAI?.model
        : providerId === 'ollama'
          ? (settings.ollamaModelInput ?? provider?.modelInputDefault)
          : resolveActiveModel(providerId, settings.modelByProvider)?.id) ??
      ''
    ).trim(),
    baseUrlOverride:
      (
        draft.baseUrlOverride ??
        settings.apiBaseUrlOverride?.[providerId] ??
        (custom ? settings.customOpenAI?.baseUrl : undefined)
      )?.trim() ||
      (custom ? settings.customOpenAI?.baseUrl?.trim() : '') ||
      (mode === 'plan' ? provider?.tokenPlan?.baseUrl : '') ||
      provider?.baseUrl ||
      '',
  });
}

export function sameProbe(
  a: ProbeConfig | null,
  b: ProbeConfig | null,
  includeModel = true,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.providerId === b.providerId &&
      a.apiKey === b.apiKey &&
      a.accessMode === b.accessMode &&
      a.baseUrlOverride === b.baseUrlOverride &&
      (!includeModel || a.model === b.model))
  );
}

/** Per-view, bounded memory cache. No raw key, hash, or catalog is persisted to settings. */
export class ProviderProbe {
  private config: ProbeConfig | null = null;
  private generation = 0;
  private view = emptyView();
  private listeners = new Set<() => void>();
  private active = new Map<
    Kind,
    { id: string; timer: ReturnType<typeof setTimeout> }
  >();
  private cache: Array<{ config: ProbeConfig; ids: string[]; at: number }> = [];
  constructor(
    private transport: Transport,
    private timeoutMs = 25_000,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.view;
  private publish(patch: Partial<View>) {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  configure(config: ProbeConfig | null) {
    if (sameProbe(this.config, config)) return;
    this.cancel();
    this.config = config ? Object.freeze({ ...config }) : null;
    this.publish({ ...emptyView(), models: this.cached() ?? [] });
  }
  cancel = () => {
    this.generation++;
    for (const { id, timer } of this.active.values()) {
      clearTimeout(timer);
      void this.transport.llmCancelProbe(id).catch(() => {});
    }
    this.active.clear();
    this.publish({ testing: false, result: null });
  };
  /** A save continuation must still belong to the same mounted/configured view. */
  checkpoint = () => {
    const generation = this.generation;
    return () => generation === this.generation && this.config !== null;
  };
  private cached(): string[] | undefined {
    return this.cache.find(
      (entry) =>
        sameProbe(entry.config, this.config, false) &&
        Date.now() - entry.at < 300_000,
    )?.ids;
  }
  catalog = () => {
    const cached = this.cached();
    if (cached) {
      this.publish({ models: cached });
      return;
    }
    this.start('catalog');
  };
  test = (config: ProbeConfig, force = true) => {
    if (!sameProbe(config, this.config) || (!force && this.view.result?.ok))
      return;
    this.start('connection');
  };
  private start(kind: Kind) {
    const config = this.config;
    if (
      !config ||
      this.active.has(kind) ||
      !config.baseUrlOverride ||
      (config.providerId !== 'ollama' && !config.apiKey)
    )
      return;
    if (kind === 'connection' && !config.model) return;
    const generation = this.generation;
    const id = crypto.randomUUID();
    const current = () =>
      this.generation === generation && this.active.get(kind)?.id === id;
    const complete = () => {
      clearTimeout(this.active.get(kind)?.timer);
      this.active.delete(kind);
    };
    const failure = (message: string) => {
      if (!current()) return;
      complete();
      if (kind === 'connection')
        this.publish({
          testing: false,
          result: {
            ok: false,
            latencyMs: 0,
            baseUrl: config.baseUrlOverride,
            error: message,
          },
        });
    };
    const timer = setTimeout(() => {
      if (!current()) return;
      failure('Probe timed out');
      void this.transport.llmCancelProbe(id).catch(() => {});
    }, this.timeoutMs);
    this.active.set(kind, { id, timer });
    if (kind === 'connection') this.publish({ testing: true, result: null });
    const request = Object.freeze({ ...config, requestId: id });
    if (kind === 'catalog') {
      void Promise.resolve()
        .then(() =>
          current()
            ? this.transport.llmListModels(request)
            : { ok: false, models: undefined },
        )
        .then((result) => {
          if (!current()) return;
          complete();
          if (result.ok && result.models) {
            const ids = [...result.models];
            this.cache = [
              { config, ids, at: Date.now() },
              ...this.cache.filter(
                (entry) => !sameProbe(config, entry.config, false),
              ),
            ].slice(0, 8);
            this.publish({ models: ids });
          }
        })
        .catch(() => failure('Model catalog request failed'));
    } else {
      void Promise.resolve()
        .then(() =>
          current() ? this.transport.llmTestConnection(request) : null,
        )
        .then((result) => {
          if (!current()) return;
          complete();
          this.publish({ testing: false, result });
        })
        .catch(() => failure('Connection probe failed'));
    }
  }
}
