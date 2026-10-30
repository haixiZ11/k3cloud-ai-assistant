/**
 * Shared LLM provider registry — ported from design/components/Providers.jsx.
 *
 * Used by settings, wizard, workspace chip, tweaks, and status bar.
 * The design prototype assigned these to `window.PROVIDERS`; here we expose
 * them as typed ES module exports instead.
 */

export type ProviderRegion = 'CN' | 'Overseas' | 'Local';

export interface LlmModel {
  /** Provider-side model id, sent to API as `model` param. */
  id: string;
  /** Display name. */
  label: string;
  /** Max input context in tokens. */
  contextWindow: number;
  /** Max output tokens (单轮 completion 上限). */
  maxOutput: number;
  /** "input/output" 单位 ¥ 或 $ per M tokens, 仅展示. */
  pricing: string;
  /** ≤12 字 sub-label, e.g. "1M · 极速". */
  hint: string;
  /** Mark exactly one model per provider as recommended (sets default). */
  recommended?: boolean;
}

export interface LlmProvider {
  id: string;
  /** Design token name used to select the brand color dot (`prov-dot ${dot}`). */
  dot: string;
  /** Single-character fallback glyph shown inside the brand dot. */
  letter: string;
  label: string;
  /** Provider-level short name (e.g. 'DeepSeek'). 模型 short 由 LlmModel.label 承担. */
  short: string;
  /** Provider-level descriptive sub (e.g. '国内直连 · 代码首选') — 不再含模型名. */
  sub: string;
  region: ProviderRegion;
  recommended?: boolean;
  /**
   * 按量计费端点 (默认 Base URL)。仅用于 SettingsPage 的 URL 字段展示 /
   * placeholder,渲染层从不直接请求它 — 真正的请求路由在 main 端
   * `PROVIDER_CONFIGS[id].baseUrl`,两端同步靠 tests/llm/provider-sync.test.ts。
   */
  baseUrl: string;
  /** Available models. Empty for Ollama (free-form input). */
  models: LlmModel[];
  /** Ollama only — 默认填到 input 框的型号. */
  modelInputDefault?: string;
  /**
   * Token Plan / Coding Plan UI 元数据。仅 UI 用 (docsUrl 帮助链接、keyPrefix
   * 软校验提示、baseUrl 展示包月端点)。请求路由的 base URL 真源在 main 端
   * `PROVIDER_CONFIGS[id].tokenPlan.baseUrl`,两端同步靠
   * tests/llm/provider-sync.test.ts 护栏。
   */
  tokenPlan?: {
    keyPrefix?: string;
    docsUrl?: string;
    /** 包月专属端点 — SettingsPage 在 plan 模式下展示/作 placeholder。 */
    baseUrl?: string;
  };
}

export const PROVIDERS: LlmProvider[] = [
  {
    id: 'deepseek', dot: 'deepseek', letter: 'D',
    label: 'DeepSeek', short: 'DeepSeek', sub: '国内直连 · 代码首选',
    region: 'CN', recommended: true,
    baseUrl: 'https://api.deepseek.com',
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', contextWindow: 1_000_000, maxOutput: 384_000, pricing: '¥1.0 / 2.0', hint: '1M · 极速', recommended: true },
      { id: 'deepseek-v4-pro',   label: 'DeepSeek V4 Pro',   contextWindow: 1_000_000, maxOutput: 384_000, pricing: '¥3 / 6',     hint: '1M · 代码首选' }
    ]
  },
  {
    id: 'qwen', dot: 'qwen', letter: 'Q',
    label: '通义 Qwen', short: '通义 Qwen', sub: '阿里 DashScope · 1M 上下文',
    region: 'CN',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { id: 'qwen3.7-max',      label: 'Qwen3.7 Max',      contextWindow: 1_000_000, maxOutput: 8_192, pricing: '¥12 / 36',  hint: '1M · 新旗舰', recommended: true },
      { id: 'qwen3.6-flash',    label: 'Qwen3.6 Flash',    contextWindow: 1_000_000, maxOutput: 8_192, pricing: '¥1.2 / 7.2', hint: '1M · 极速' },
      { id: 'qwen3.6-plus',     label: 'Qwen3.6 Plus',     contextWindow: 1_000_000, maxOutput: 8_192, pricing: '¥2 / 12',    hint: '1M · 主力' },
      { id: 'qwen3-max',        label: 'Qwen3 Max',        contextWindow: 256_000,   maxOutput: 8_192, pricing: '¥2.5 / 10',  hint: '256K · 上一代' },
      { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus', contextWindow: 1_000_000, maxOutput: 8_192, pricing: '¥4 / 16',    hint: '1M · 代码' }
    ],
    tokenPlan: {
      keyPrefix: 'sk-sp-',
      docsUrl: 'https://help.aliyun.com/zh/model-studio/coding-plan',
      baseUrl: 'https://coding.dashscope.aliyuncs.com/v1'
    }
  },
  {
    id: 'glm', dot: 'glm', letter: '智',
    label: '智谱 GLM', short: '智谱 GLM', sub: '智谱 BigModel · 性价比高',
    region: 'CN',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { id: 'glm-4.7-flashx', label: 'GLM-4.7 FlashX', contextWindow: 200_000,   maxOutput: 128_000, pricing: '¥0.5 / 1.5', hint: '200K · 性价比', recommended: true },
      { id: 'glm-4.7',        label: 'GLM-4.7',        contextWindow: 200_000,   maxOutput: 128_000, pricing: '¥4 / 16',    hint: '200K · 通用' },
      { id: 'glm-5.1',        label: 'GLM-5.1',        contextWindow: 200_000,   maxOutput: 128_000, pricing: '¥8 / 32',    hint: '200K · 最新旗舰' },
      { id: 'glm-4-long',     label: 'GLM-4 Long',     contextWindow: 1_000_000, maxOutput: 4_096,   pricing: '¥1 / 8',     hint: '1M · 长文本' }
    ],
    tokenPlan: {
      docsUrl: 'https://docs.bigmodel.cn/cn/guide/develop/http/introduction',
      baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4'
    }
  },
  {
    id: 'kimi', dot: 'kimi', letter: 'K',
    label: 'Moonshot Kimi', short: 'Kimi', sub: 'Moonshot · 长上下文 + 代码',
    region: 'CN',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'kimi-k2.6', label: 'Kimi K2.6', contextWindow: 262_144, maxOutput: 16_384, pricing: '¥6.5 / 27', hint: '262K · 主力', recommended: true },
      { id: 'kimi-k2.5', label: 'Kimi K2.5', contextWindow: 262_144, maxOutput: 16_384, pricing: '¥4 / 21',   hint: '262K · 经济' }
    ],
    tokenPlan: {
      docsUrl: 'https://platform.kimi.com/docs',
      baseUrl: 'https://api.kimi.com/coding/v1'
    }
  },
  {
    id: 'doubao', dot: 'doubao', letter: '豆',
    label: '字节 豆包', short: '豆包', sub: '火山方舟 · 国内直连',
    region: 'CN',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { id: 'doubao-seed-2-0-pro-260215',  label: 'Doubao Seed 2.0 Pro',  contextWindow: 256_000, maxOutput: 16_384, pricing: '¥3.2 / 16',  hint: '256K · 主力', recommended: true },
      { id: 'doubao-seed-2-0-lite-260215', label: 'Doubao Seed 2.0 Lite', contextWindow: 256_000, maxOutput: 16_384, pricing: '¥0.6 / 3.6', hint: '256K · 经济' },
      { id: 'doubao-seed-2-0-mini-260215', label: 'Doubao Seed 2.0 Mini', contextWindow: 256_000, maxOutput: 16_384, pricing: '¥0.2 / 2.0', hint: '256K · 最低价' },
      { id: 'doubao-seed-1-6-260215',      label: 'Doubao Seed 1.6',      contextWindow: 256_000, maxOutput: 16_384, pricing: '¥0.8 / 8.0', hint: '256K · 上一代' }
    ],
    tokenPlan: {
      docsUrl: 'https://www.volcengine.com/docs/82379/1925114',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3'
    }
  },
  {
    id: 'hunyuan', dot: 'hunyuan', letter: '腾',
    label: '腾讯 混元', short: '混元', sub: '腾讯云 · 多模态',
    region: 'CN',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    models: [
      { id: 'hunyuan-turbos-latest',         label: 'Hunyuan TurboS',       contextWindow: 32_000,  maxOutput: 16_384, pricing: '¥0.8 / 2.0 (待校准)', hint: '32K · 主力',  recommended: true },
      { id: 'hunyuan-2.0-thinking-20251109', label: 'Hunyuan 2.0 Thinking', contextWindow: 128_000, maxOutput: 64_000, pricing: '¥3 / 9 (待校准)',     hint: '128K · 推理' },
      { id: 'hunyuan-lite',                   label: 'Hunyuan Lite',         contextWindow: 256_000, maxOutput: 6_144,  pricing: 'free',                hint: '256K · 免费' }
    ]
  },
  {
    id: 'minimax', dot: 'minimax', letter: 'M',
    label: 'MiniMax', short: 'MiniMax', sub: '海螺 AI · 长输出',
    region: 'CN',
    baseUrl: 'https://api.minimax.chat/v1',
    models: [
      // id is `MiniMax-M2.7` (mixed case) — that's MiniMax's canonical API string, do not lowercase.
      { id: 'MiniMax-M2.7', label: 'MiniMax M2.7', contextWindow: 196_608, maxOutput: 8_192, pricing: '¥2.1 / 8.4', hint: '196K · 主力', recommended: true }
    ]
  },
  {
    id: 'mimo', dot: 'mimo', letter: '米',
    label: '小米 MiMo', short: 'MiMo', sub: '小米开放平台 · 1M 上下文',
    region: 'CN',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    models: [
      { id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro',  contextWindow: 1_000_000, maxOutput: 128_000, pricing: '¥— / — (待校准)', hint: '1M · 文本主力', recommended: true },
      { id: 'mimo-v2.5',     label: 'MiMo V2.5 Omni', contextWindow: 1_000_000, maxOutput: 128_000, pricing: '¥— / — (待校准)', hint: '1M · 全模态' },
      { id: 'mimo-v2-flash', label: 'MiMo V2 Flash',  contextWindow: 256_000,   maxOutput: 64_000,  pricing: '¥— / — (待校准)', hint: '256K · 极速' }
    ],
    tokenPlan: {
      keyPrefix: 'tp-',
      docsUrl: 'https://platform.xiaomimimo.com/docs/zh-CN/price/tokenplan/subscription',
      baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1'
    }
  },
  {
    id: 'claude', dot: 'claude', letter: 'A',
    label: 'Anthropic Claude', short: 'Claude', sub: '海外需代理 · 推理强',
    region: 'Overseas',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5',  contextWindow: 200_000,   maxOutput: 64_000,  pricing: '$1 / 5',  hint: '200K · 速度', recommended: true },
      { id: 'claude-sonnet-4-6',         label: 'Claude Sonnet 4.6', contextWindow: 1_000_000, maxOutput: 64_000,  pricing: '$3 / 15', hint: '1M · 主力' },
      { id: 'claude-opus-4-8',           label: 'Claude Opus 4.8',   contextWindow: 1_000_000, maxOutput: 128_000, pricing: '$5 / 25', hint: '1M · 顶配' }
    ]
  },
  {
    id: 'gpt', dot: 'openai', letter: 'G',
    label: 'OpenAI GPT', short: 'GPT', sub: '海外需代理 · 通用强',
    region: 'Overseas',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-5.5',      label: 'GPT-5.5',      contextWindow: 1_000_000, maxOutput: 100_000, pricing: '$5 / 30',     hint: '1M · 顶配', recommended: true },
      { id: 'gpt-5.4',      label: 'GPT-5.4',      contextWindow: 1_000_000, maxOutput: 100_000, pricing: '$2.5 / 15',   hint: '1M · 中端' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', contextWindow: 200_000,   maxOutput: 16_384,  pricing: '$0.75 / 4.5', hint: '200K · 经济' }
    ]
  },
  {
    id: 'custom-openai', dot: 'openai', letter: 'C',
    label: '自定义 模型', short: '自定义', sub: '兼容 OpenAI · 自定义地址',
    region: 'Overseas',
    baseUrl: '',
    models: []
  },
  {
    id: 'ollama', dot: 'ollama', letter: 'O',
    label: 'Ollama 本地', short: 'Ollama', sub: '完全离线 · 自定义模型',
    region: 'Local',
    baseUrl: 'http://localhost:11434',
    models: [],
    modelInputDefault: 'qwen2.5-coder'
  }
];

export const PROVIDER_BY_ID: Record<string, LlmProvider> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p])
);

/**
 * Pick the active model for a provider given the user's stored selection.
 * Falls back to recommended → first-in-list → null.
 * Returns null for Ollama (caller uses provider.modelInputDefault + free-form input).
 *
 * A stored id OUTSIDE the bundled catalog (user-typed custom model, or a
 * model released after this build) is returned with degraded metadata
 * instead of being dropped — the id must reach the API unchanged, that's
 * the whole point of the custom-model escape hatch.
 */
export function resolveActiveModel(
  providerId: string,
  modelByProvider: Record<string, string> | undefined
): LlmModel | null {
  const provider = PROVIDER_BY_ID[providerId];
  if (!provider || provider.models.length === 0) return null;
  const stored = modelByProvider?.[providerId];
  if (stored) {
    const found = provider.models.find((m) => m.id === stored);
    if (found) return found;
    return {
      id: stored,
      label: stored,
      contextWindow: 128_000, // 未知模型的保守估计,仅用于状态栏进度条
      maxOutput: 8_192,
      pricing: '—',
      hint: ''
    };
  }
  return provider.models.find((m) => m.recommended) ?? provider.models[0];
}
