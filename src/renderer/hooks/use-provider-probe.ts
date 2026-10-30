import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderProbe, type ProbeConfig } from '../stores/provider-probe';

export function useProviderProbe(config: ProbeConfig, enabled = true) {
  const { t } = useTranslation();
  const ref = useRef<ProviderProbe | null>(null);
  if (!ref.current)
    ref.current = new ProviderProbe({
      llmListModels: (request) => window.opendeploy.llmListModels(request),
      llmTestConnection: (request) =>
        window.opendeploy.llmTestConnection(request),
      llmCancelProbe: (id) => window.opendeploy.llmCancelProbe(id),
    });
  const probe = ref.current;
  useLayoutEffect(() => {
    probe.configure(enabled ? config : null);
    return () => probe.configure(null);
  }, [
    probe,
    enabled,
    config.providerId,
    config.apiKey,
    config.accessMode,
    config.baseUrlOverride,
    config.model,
  ]);
  const view = useSyncExternalStore(
    probe.subscribe,
    probe.getSnapshot,
    probe.getSnapshot,
  );
  const error = view.result?.error;
  const localizedError =
    error === 'Probe timed out'
      ? t('settings.probeTimeout')
      : error === 'Probe cancelled'
        ? t('settings.probeCancelled')
        : error === 'Connection probe failed'
          ? t('settings.probeFailed')
          : error;
  return {
    probe,
    ...view,
    result: view.result ? { ...view.result, error: localizedError } : null,
  };
}
