import { describe, it, expect } from 'vitest';
import { PROVIDER_CONFIGS } from '../../src/main/llm/types';
import { PROVIDERS } from '../../src/renderer/data/providers';

/**
 * Provider metadata lives in two places by design:
 *   - `PROVIDER_CONFIGS[id].{baseUrl, tokenPlan.{baseUrl, keyPrefix, docsUrl}}` —
 *     main side, used by `resolveProviderEndpoint` to route requests.
 *   - `PROVIDERS.find(id).{baseUrl, tokenPlan.{baseUrl, keyPrefix, docsUrl}}` —
 *     renderer side, used by Settings/Wizard for the access-mode toggle, the
 *     help link, and the always-visible "API 地址" field placeholder.
 *
 * The renderer never calls upstream directly, but everything it DISPLAYS must
 * agree with what main actually routes to — otherwise the placeholder shows a
 * URL the request never hits. This 护栏 fails when someone updates one side
 * and forgets the other.
 */
describe('provider metadata sync (main ↔ renderer)', () => {
  it('every renderer-side tokenPlan has a matching main-side tokenPlan', () => {
    for (const p of PROVIDERS) {
      if (!p.tokenPlan) continue;
      const main = PROVIDER_CONFIGS[p.id]?.tokenPlan;
      expect(main, `PROVIDER_CONFIGS.${p.id}.tokenPlan missing`).toBeDefined();
      expect(main!.keyPrefix).toBe(p.tokenPlan.keyPrefix);
      expect(main!.docsUrl).toBe(p.tokenPlan.docsUrl);
      expect(main!.baseUrl).toBe(p.tokenPlan.baseUrl);
    }
  });

  it('every main-side tokenPlan has a matching renderer-side tokenPlan', () => {
    for (const id of Object.keys(PROVIDER_CONFIGS)) {
      const main = PROVIDER_CONFIGS[id].tokenPlan;
      if (!main) continue;
      const renderer = PROVIDERS.find((p) => p.id === id)?.tokenPlan;
      expect(renderer, `PROVIDERS[${id}].tokenPlan missing`).toBeDefined();
      expect(renderer!.keyPrefix).toBe(main.keyPrefix);
      expect(renderer!.docsUrl).toBe(main.docsUrl);
      expect(renderer!.baseUrl).toBe(main.baseUrl);
    }
  });

  it('payg baseUrl agrees across both sides (custom-openai exempt — 用户自填)', () => {
    for (const p of PROVIDERS) {
      if (p.id === 'custom-openai') continue;
      const main = PROVIDER_CONFIGS[p.id];
      expect(main, `PROVIDER_CONFIGS.${p.id} missing`).toBeDefined();
      expect(main!.baseUrl).toBe(p.baseUrl);
    }
    for (const id of Object.keys(PROVIDER_CONFIGS)) {
      if (id === 'custom-openai') continue;
      const renderer = PROVIDERS.find((p) => p.id === id);
      expect(renderer, `PROVIDERS[${id}] missing`).toBeDefined();
      expect(renderer!.baseUrl).toBe(PROVIDER_CONFIGS[id].baseUrl);
    }
  });
});
