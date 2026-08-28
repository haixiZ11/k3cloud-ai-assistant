import type { ChatRequest, StreamEvent } from '@shared/llm-types';
import type { LlmClient } from './types';
import { resolveStreamOpts } from './types';
import { parseSseStream } from './sse';

interface AnthropicOpts {
  baseUrl: string;
  defaultModel: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

/**
 * Map the shared Message history to Anthropic Messages API turns.
 *
 * Contract gotchas this must uphold:
 * - Every assistant `toolCalls` entry MUST be replayed as a `tool_use`
 *   content block. A user turn carrying `tool_result` blocks that
 *   reference a `tool_use_id` with no matching `tool_use` block is a hard
 *   400 ("unexpected tool_use_id") — and that user turn is exactly the
 *   round-2 shape of the agent loop, so dropping tool_use breaks every
 *   multi-turn tool conversation.
 * - Parallel tool calls are separate `tool` role messages in our history;
 *   Anthropic wants them folded into ONE user turn, so consecutive tool
 *   results are merged here.
 * - Extended-thinking turns replay `thinking` (with signature) first, then
 *   text, then tool_use — the order Claude produced them in.
 * - Plain-text turns keep `content` as a bare string so the wire shape of
 *   existing conversations is unchanged.
 */
export function toAnthropicConversation(messages: ChatRequest['messages']): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // handled separately in the request body
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const prev = out[out.length - 1];
      const prevIsToolResults =
        prev?.role === 'user' &&
        Array.isArray(prev.content) &&
        prev.content.length > 0 &&
        prev.content.every((b) => b.type === 'tool_result');
      if (prevIsToolResults) (prev.content as Array<Record<string, unknown>>).push(block);
      else out.push({ role: 'user', content: [block] });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = [];
      // Claude requires the exact thinking text + signature to be replayed,
      // otherwise the thinking chain is dropped and multi-turn tool-use with
      // adaptive thinking (Opus 4.7) / extended thinking (Sonnet 4.6) breaks.
      if (m.reasoningContent && m.reasoningSignature) {
        blocks.push({
          type: 'thinking',
          thinking: m.reasoningContent,
          signature: m.reasoningSignature
        });
      }
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
      }
      if (blocks.length === 0 || (blocks.length === 1 && blocks[0].type === 'text')) {
        out.push({ role: 'assistant', content: m.content });
      } else {
        out.push({ role: 'assistant', content: blocks });
      }
      continue;
    }
    out.push({ role: 'user', content: m.content });
  }
  return out;
}

export function createAnthropicClient(opts: AnthropicOpts): LlmClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async *stream(req: ChatRequest, optsOrSignal?): AsyncIterable<StreamEvent> {
      const { abortSignal: signal, rawCapture } = resolveStreamOpts(optsOrSignal);
      // Split out system messages (Anthropic takes them separately)
      const systemParts = req.messages.filter(m => m.role === 'system').map(m => m.content);
      const conversation = toAnthropicConversation(req.messages);

      const body = {
        model: req.model ?? opts.defaultModel,
        max_tokens: req.maxTokens ?? 4096,
        stream: true,
        ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
        messages: conversation,
        ...(req.tools && req.tools.length > 0 ? {
          tools: req.tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters
          }))
        } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {})
      };

      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': req.apiKey ?? '',
        'anthropic-version': '2023-06-01'
      };
      rawCapture?.onRequest(body, headers);

      let response: Response;
      try {
        response = await fetchImpl(`${opts.baseUrl}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal
        });
      } catch (err) {
        await rawCapture?.onClose();
        yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
        return;
      }

      if (!response.ok) {
        const text = await response.text();
        rawCapture?.onChunk(`HTTP ${response.status}\n${text}`);
        await rawCapture?.onClose();
        yield { type: 'error', error: `HTTP ${response.status}: ${text}` };
        return;
      }
      if (!response.body) {
        await rawCapture?.onClose();
        yield { type: 'error', error: 'no body' };
        return;
      }

      const reader = response.body.getReader();
      const stream: AsyncIterable<Uint8Array> = {
        async *[Symbol.asyncIterator]() {
          while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            if (value) yield value;
          }
        }
      };

      let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const dataStr of parseSseStream(stream)) {
        rawCapture?.onChunk(dataStr);
        let data: any;
        try { data = JSON.parse(dataStr); } catch { continue; }

        if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
          yield { type: 'delta', content: data.delta.text ?? '' };
        } else if (data.type === 'content_block_delta' && data.delta?.type === 'thinking_delta') {
          // Extended-thinking text chunks (Opus 4.7 adaptive / Sonnet 4.6
          // extended). Parallel to text_delta but streamed into a separate
          // `thinking` content block. Caller must persist + replay.
          yield { type: 'reasoning_delta', content: data.delta.thinking ?? '' };
        } else if (data.type === 'content_block_delta' && data.delta?.type === 'signature_delta') {
          // Signature emitted at the end of a thinking block. Must be
          // round-tripped verbatim with the thinking text, otherwise Claude
          // rejects the multi-turn continuation.
          yield { type: 'reasoning_signature', signature: data.delta.signature ?? '' };
        } else if (data.type === 'message_delta') {
          const sr = data.delta?.stop_reason;
          if (sr === 'tool_use') finishReason = 'tool_calls';
          else if (sr === 'max_tokens') finishReason = 'length';
          else finishReason = 'stop';
          if (data.usage?.output_tokens) {
            outputTokens = data.usage.output_tokens;
            yield { type: 'usage', outputTokens };
          }
        } else if (data.type === 'message_start') {
          inputTokens = data.message?.usage?.input_tokens ?? 0;
        } else if (data.type === 'message_stop') {
          yield {
            type: 'done',
            finishReason,
            usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
          };
          await rawCapture?.onClose();
          return;
        }
      }
      // Stream ended without a `message_stop` event (rare — connection cut?).
      // Still flush the capture so we don't leak the buffered chunks.
      await rawCapture?.onClose();
    }
  };
}
