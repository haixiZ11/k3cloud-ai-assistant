import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_BY_ID, resolveActiveModel } from '../../src/renderer/data/providers';

describe('providers + models', () => {
  it('every provider declares models[] (Ollama / custom-openai may be empty)', () => {
    for (const p of PROVIDERS) {
      expect(p.models).toBeDefined();
      expect(Array.isArray(p.models)).toBe(true);
      // custom-openai 是自由输入型 provider (模型名手填),内置目录为空是设计使然;
      // ollama 同理。其余每家必须有目录且 recommended 恰好一条。
      if (p.id !== 'ollama' && p.id !== 'custom-openai') {
        expect(p.models.length).toBeGreaterThan(0);
        expect(p.models.filter((m) => m.recommended).length).toBe(1);
      }
    }
  });

  it('every builtin provider declares a baseUrl (URL 字段展示用)', () => {
    for (const p of PROVIDERS) {
      if (p.id === 'custom-openai') continue; // 地址由用户填写 (customOpenAI.baseUrl)
      expect(p.baseUrl, `${p.id}.baseUrl missing`).toBeTruthy();
      expect(p.baseUrl.startsWith('http')).toBe(true);
    }
  });

  it('every model has id / label / contextWindow / maxOutput / pricing / hint', () => {
    for (const p of PROVIDERS) {
      for (const m of p.models) {
        expect(m.id).toBeTruthy();
        expect(m.label).toBeTruthy();
        expect(m.contextWindow).toBeGreaterThan(0);
        expect(m.maxOutput).toBeGreaterThan(0);
        expect(m.pricing).toBeTruthy();
        expect(m.hint).toBeTruthy();
      }
    }
  });

  it('Ollama declares modelInputDefault', () => {
    const ollama = PROVIDER_BY_ID['ollama'];
    expect(ollama.models).toEqual([]);
    expect(ollama.modelInputDefault).toBeTruthy();
  });

  it('resolveActiveModel returns user choice when valid', () => {
    const m = resolveActiveModel('deepseek', { deepseek: 'deepseek-v4-pro' });
    expect(m?.id).toBe('deepseek-v4-pro');
  });

  it('resolveActiveModel keeps stored custom ids (降级元数据,不再回退丢弃)', () => {
    // 回归锁:用户手填 / 后台拉到的新模型 id 不在内置目录时必须原样透传,
    // 否则"同样的 API 和 KEY 却无法调用新模型"。
    const m = resolveActiveModel('deepseek', { deepseek: 'no-such-model' });
    expect(m?.id).toBe('no-such-model');
    expect(m?.label).toBe('no-such-model');
    expect(m?.contextWindow).toBeGreaterThan(0);
  });

  it('resolveActiveModel falls back to recommended when not stored at all', () => {
    const m = resolveActiveModel('claude', {});
    expect(m?.id).toBe('claude-haiku-4-5-20251001'); // recommended
  });

  it('resolveActiveModel for ollama returns null (用 modelInputDefault 走另一路径)', () => {
    const m = resolveActiveModel('ollama', {});
    expect(m).toBeNull();
  });

  it('resolveActiveModel returns null for unknown providerId', () => {
    const m = resolveActiveModel('does-not-exist', { 'does-not-exist': 'whatever' });
    expect(m).toBeNull();
  });
});
