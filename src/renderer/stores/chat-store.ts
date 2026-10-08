import { create } from 'zustand';
import type { LlmStreamEvent } from '@shared/types';
import { makeId } from '@shared/id';
import { useArtifactsStore } from './artifacts-store';
import {
  appendTextDelta,
  appendToolUse,
  reconstructBlocksFromLegacy,
  type MessageBlock
} from '@shared/blocks';
import { resolveActiveModel, PROVIDER_BY_ID } from '@renderer/data/providers';
import { useSettingsStore } from './settings-store';
import { useProjectsStore } from './projects-store';

export type { MessageBlock } from '@shared/blocks';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: string;
    result?: string;
    /** ms since epoch — set when tool_call event arrives, drives elapsed time UI. */
    startedAt?: number;
  }>;
  /**
   * Ordered stream of text and tool_use blocks as they arrived. When present,
   * the renderer iterates this instead of rendering content + toolCalls
   * separately — preserves the "said X, did tool, said Y" causal order the
   * user sees in Claude Code. Legacy messages (persisted before blocks
   * existed) have this reconstructed at load time from content + toolCalls.
   */
  blocks?: MessageBlock[];
  isStreaming?: boolean;
  /** 文字 delta 累计缓冲 — 在 tool_call / done 时 flush 成 blocks 里的 text block。
   *  Streaming 期间 UI 不渲染这段文字本身,只用 pendingTokens 显示进度。 */
  pendingText?: string;
  /** Streaming 期间累计的 output token 估算/精确数。delta 事件按 +1 估算;
   *  usage 事件到达时替换为 provider 给的精确值。 */
  pendingTokens?: number;
  /** True 表示 pendingTokens 来自 provider 的 usage event (精确), false / 缺失
   *  表示按 delta 事件估算 (UI 加 `~` 前缀)。 */
  tokensExact?: boolean;
  createdAt: string;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  currentRequestId: string | null;
  conversationId: string | null;

  sendMessage: (
    text: string,
    providerId: string,
    apiKey: string | undefined,
    accessMode?: 'payg' | 'plan'
  ) => Promise<boolean>;
  abort: () => Promise<void>;
  clear: () => void;
  loadConversation: (id: string) => Promise<void>;
}

const makeChatId = () => makeId('c');

/**
 * Commit a streaming message's pendingText into its blocks/content as a
 * single text block, then clear the pending fields. Called on tool_call /
 * done boundaries. Returns the original message unchanged (identity) when
 * there's nothing to flush.
 *
 * NOTE: error 和 abort 路径都会 flush — error 处理器在追加错误行前先 flush;
 * abort 由主进程 loop 以 done 收尾(loop.ts 保留半截内容正常返回),所以
 * 用户已经"等出来"的那部分回复可见、也随会话落盘,不再整体丢弃。
 */
export function flushPendingText(msg: ChatMessage): ChatMessage {
  if (!msg.pendingText) return msg;
  return {
    ...msg,
    content: msg.content + msg.pendingText,
    blocks: appendTextDelta(msg.blocks ?? [], msg.pendingText),
    pendingText: undefined,
    pendingTokens: undefined,
    tokensExact: undefined
  };
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  error: null,
  currentRequestId: null,
  conversationId: null,

  sendMessage: async (text, providerId, apiKey, accessMode) => {
    const userMsg: ChatMessage = {
      id: makeChatId(), role: 'user', content: text, createdAt: new Date().toISOString()
    };
    const assistantMsg: ChatMessage = {
      id: makeChatId(), role: 'assistant', content: '', blocks: [], isStreaming: true, createdAt: new Date().toISOString()
    };
    set({
      messages: [...get().messages, userMsg, assistantMsg],
      isStreaming: true, error: null
    });

    // Subscribe to stream events (unsubscribe when done)
    // ─── 流式渲染节流 ───
    // delta / reasoning_delta 每秒可达几十上百次,逐条 set() 会让整个消息
    // 列表跟着重渲染。缓冲进本 closure,每 STREAM_FLUSH_MS 批量上屏一次;
    // 低频事件(tool_call/usage/done/error)到达时先同步 flush,保住
    // "文字 → 工具卡片" 的边界顺序不乱。
    const STREAM_FLUSH_MS = 100;
    let bufText = '';
    let bufTokens = 0;
    let bufDirty = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushBuffer = (): void => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!bufDirty) return;
      bufDirty = false;
      const text = bufText;
      const tokens = bufTokens;
      bufText = '';
      bufTokens = 0;
      const msgs = [...get().messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        msgs[msgs.length - 1] = {
          ...last,
          pendingText: (last.pendingText ?? '') + text,
          ...(last.tokensExact ? {} : { pendingTokens: (last.pendingTokens ?? 0) + tokens })
        };
        set({ messages: msgs });
      }
    };
    const scheduleFlush = (): void => {
      if (flushTimer !== null) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushBuffer();
      }, STREAM_FLUSH_MS);
    };

    const unsubscribe = window.opendeploy.llmOnStream((ev: LlmStreamEvent) => {
      if (ev.requestId !== get().currentRequestId) return;

      if (ev.type === 'delta' && ev.content) {
        bufText += ev.content;
        bufTokens += 1;
        bufDirty = true;
        scheduleFlush();
      } else if (ev.type === 'reasoning_delta' && ev.content) {
        // DeepSeek / Claude extended-thinking 的推理阶段:文字不进正文,
        // 但计数器要动 — 否则思考期间界面看起来像冻死,用户会以为卡了。
        bufTokens += 1;
        bufDirty = true;
        scheduleFlush();
      } else if (ev.type === 'tool_call') {
        flushBuffer(); // 先把缓冲的文字落盘,再挂工具卡片 — 保住到达顺序
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          const flushed = flushPendingText(last);
          const callId = ev.toolCallId ?? '?';
          msgs[msgs.length - 1] = {
            ...flushed,
            toolCalls: [
              ...(flushed.toolCalls ?? []),
              {
                id: callId,
                name: ev.toolCallName ?? '?',
                args: ev.toolCallArgs ?? '',
                startedAt: Date.now()
              }
            ],
            blocks: appendToolUse(flushed.blocks ?? [], callId)
          };
          set({ messages: msgs });
        }
      } else if (ev.type === 'tool_result') {
        // Match by toolCallId — parallel batches return out of order, so
        // "last in array" would clobber the wrong slot.
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant' && last.toolCalls && last.toolCalls.length > 0) {
          const tcs = [...last.toolCalls];
          const idx = ev.toolCallId
            ? tcs.findIndex((tc) => tc.id === ev.toolCallId)
            : -1;
          if (idx >= 0) {
            const matched = tcs[idx];
            tcs[idx] = { ...matched, result: ev.content ?? '' };
            msgs[msgs.length - 1] = { ...last, toolCalls: tcs };
            set({ messages: msgs });
            useArtifactsStore.getState().addFromToolResult(matched.name, ev.content ?? '');
          }
        }
      } else if (ev.type === 'usage') {
        flushBuffer(); // 先把缓冲的估算 +1 落上去,随后精确值整体覆盖
        // Ignore meaningless usage (e.g. Ollama emitting 0 when eval_count is missing) —
        // otherwise the delta-based estimate gets clobbered with 0 and stamped exact.
        if (typeof ev.outputTokens !== 'number' || ev.outputTokens <= 0) return;
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = {
            ...last,
            pendingTokens: ev.outputTokens,
            tokensExact: true
          };
          set({ messages: msgs });
        }
      } else if (ev.type === 'done') {
        flushBuffer(); // 收尾前把尾巴上的 delta 落盘,随 flushPendingText 一起提交
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last) {
          // flushPendingText 短路掉无 pendingText 的消息(只调工具的 turn),
          // 但 pendingTokens / tokensExact 可能因 usage 事件先到而残留 ——
          // done 时无条件清掉避免数据残留(纯卫生,UI 不显示也无害)。
          const flushed = flushPendingText(last);
          msgs[msgs.length - 1] = {
            ...flushed,
            isStreaming: false,
            pendingTokens: undefined,
            tokensExact: undefined
          };
        }
        set({ messages: msgs, isStreaming: false, currentRequestId: null });
        unsubscribe();
      } else if (ev.type === 'error') {
        flushBuffer(); // 错误信息追加到完整文本上,缓冲的尾巴不能丢
        const errText = ev.error ?? 'Unknown error';
        const msgs = [...get().messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          const flushed = flushPendingText(last);
          msgs[msgs.length - 1] = {
            ...flushed,
            content: flushed.content ? `${flushed.content}\n\n[error] ${errText}` : `[error] ${errText}`,
            isStreaming: false,
            pendingTokens: undefined,
            tokensExact: undefined
          };
        }
        set({ messages: msgs, error: errText, isStreaming: false, currentRequestId: null });
        unsubscribe();
      }
    });

    try {
      // Resolve model id from settings. Ollama uses free-form ollamaModelInput,
      // every other provider uses modelByProvider[providerId] → recommended fallback.
      const settings = useSettingsStore.getState().settings;
      let modelId: string | undefined;
      if (providerId === 'ollama') {
        const provider = PROVIDER_BY_ID['ollama'];
        modelId = settings.ollamaModelInput?.trim() || provider?.modelInputDefault;
      } else {
        modelId = resolveActiveModel(providerId, settings.modelByProvider)?.id;
      }

      const { requestId } = await window.opendeploy.llmSendMessage({
        conversationId: get().conversationId ?? undefined,
        providerId,
        apiKey,
        model: modelId,
        accessMode,
        userMessage: text
      });
      set({ currentRequestId: requestId, conversationId: get().conversationId ?? requestId });
      return true;
    } catch (err) {
      flushBuffer(); // 已到达的 delta 不能随失败一起丢
      unsubscribe();
      const errMsg = err instanceof Error ? err.message : String(err);
      // 占位 assistant 消息自身的 isStreaming 也要清掉 — Message 组件的
      // thinking 动画和 token 轮询读的是消息上的标志,只复位 store 级
      // isStreaming 的话,失败后动画和 500ms 轮询会永久空转。
      const msgs = [...get().messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && last.isStreaming) {
        msgs[msgs.length - 1] = {
          ...last,
          isStreaming: false,
          pendingTokens: undefined,
          tokensExact: undefined
        };
      }
      set({ messages: msgs, error: errMsg, isStreaming: false });
      return false;
    }
  },

  abort: async () => {
    const id = get().currentRequestId;
    const finishLocally = () => {
      const msgs = [...get().messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && last.isStreaming) {
        const flushed = flushPendingText(last);
        msgs[msgs.length - 1] = {
          ...flushed,
          isStreaming: false,
          pendingTokens: undefined,
          tokensExact: undefined
        };
      }
      set({ messages: msgs, isStreaming: false, currentRequestId: null });
    };

    // 兜底看门狗 — 无条件布置:正常情况下主进程收到 abort 后立即以 done
    // 收尾(loop 已与停止信号竞速),done 会先把 currentRequestId 清掉,
    // 看门狗触发时发现 id 对不上就自动退位。若遇到任何意料之外的挂起,
    // 10s 后强制解锁,用户绝不被永久卡在"停止不了"的状态。
    window.setTimeout(() => {
      if (get().currentRequestId !== id) return;
      finishLocally();
    }, 10_000);

    if (!id) {
      // 没有可取消的请求但 UI 还在流式状态 = 状态已失联,立即本地解锁
      if (get().isStreaming) finishLocally();
      return;
    }
    try {
      await window.opendeploy.llmAbort(id);
    } catch (err) {
      // IPC 失败不再静默吞掉 — 控制台留痕,看门狗负责解锁
      console.error('llm:abort IPC failed', err);
    }
  },

  clear: () => {
    useArtifactsStore.getState().clear();
    set({ messages: [], conversationId: null, error: null });
  },

  loadConversation: async (id) => {
    const conv = await window.opendeploy.conversationsLoad(id);

    // Auto-switch active project to whatever this conversation was started under,
    // so agent tools (k3cloud_*) and StatusBar reflect the right ERP context.
    // Skipped silently when: legacy conversation has no projectId, target project
    // was deleted (not in projects[]), or it's already active.
    if (conv.projectId) {
      const projects = useProjectsStore.getState();
      const exists = projects.projects.some((p) => p.id === conv.projectId);
      if (exists && projects.connectionState.projectId !== conv.projectId) {
        await projects.setActive(conv.projectId);
      }
    }

    // Build tool_call_id → tool name map across every assistant message,
    // and tool_call_id → result content map across every `tool` role message.
    // The first powers artifacts re-hydration; the second lets us inline
    // each tool call's result back onto the assistant message so the UI
    // shows tool bubbles when switching to historical conversations.
    const toolNameById = new Map<string, string>();
    const toolResultById = new Map<string, string>();
    for (const m of conv.messages) {
      if (m.role === 'assistant' && m.toolCalls) {
        for (const tc of m.toolCalls) toolNameById.set(tc.id, tc.name);
      } else if (m.role === 'tool' && m.toolCallId) {
        toolResultById.set(m.toolCallId, m.content);
      }
    }

    // Re-hydrate the artifacts panel — without this, switching conversations
    // leaves the panel showing the previous chat's files (or empty).
    const artifacts = useArtifactsStore.getState();
    artifacts.clear();
    for (const m of conv.messages) {
      if (m.role === 'tool' && m.toolCallId) {
        const name = toolNameById.get(m.toolCallId);
        if (name) artifacts.addFromToolResult(name, m.content);
      }
    }

    const messages: ChatMessage[] = conv.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => {
        const base: ChatMessage = {
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          createdAt: m.createdAt
        };
        if (m.role === 'assistant') {
          const toolCalls = (m.toolCalls ?? []).map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: JSON.stringify(tc.arguments),
            result: toolResultById.get(tc.id)
          }));
          if (toolCalls.length > 0) base.toolCalls = toolCalls;
          // Prefer persisted stream order; fall back to "text first then
          // all tools" for conversations saved before blocks support.
          base.blocks = m.blocks && m.blocks.length > 0
            ? m.blocks
            : reconstructBlocksFromLegacy(m.content, toolCalls.map((tc) => ({ id: tc.id })));
        }
        return base;
      });
    set({ messages, conversationId: conv.id, error: null, isStreaming: false });
  }
}));
