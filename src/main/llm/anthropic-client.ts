import type { ChatRequest, StreamEvent } from '@shared/llm-types';
import type { LlmClient } from './types';
import { resolveStreamOpts } from './types';
import { parseSseStream } from './sse';
import { AnthropicToolStream } from './anthropic-tool-stream';

interface AnthropicOpts {
  baseUrl: string;
  defaultModel: string;
  fetchImpl?: typeof fetch;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

/** Replay tool calls with their results; preserve signed thinking and plain text. */
function toAnthropicConversation(messages: ChatRequest['messages']): AnthropicMessage[] {
  const conversation: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: message.toolCallId, content: message.content };
      const previous = conversation[conversation.length - 1];
      // Parallel results belong together in the user turn immediately after
      // the assistant's tool_use blocks. Never fold across ordinary messages.
      if (previous?.role === 'user' && Array.isArray(previous.content) &&
          previous.content.length > 0 && previous.content.every((b) => b.type === 'tool_result')) {
        previous.content.push(block);
      } else {
        conversation.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (message.role === 'assistant' &&
        (message.toolCalls?.length || (message.reasoningContent && message.reasoningSignature))) {
      const blocks: Array<Record<string, unknown>> = [];
      if (message.reasoningContent && message.reasoningSignature) {
        blocks.push({
          type: 'thinking', thinking: message.reasoningContent, signature: message.reasoningSignature,
        });
      }
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      conversation.push({ role: 'assistant', content: blocks });
    } else {
      conversation.push({ role: message.role, content: message.content });
    }
  }
  return conversation;
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
      const tools = new AnthropicToolStream();

      try {
        for await (const dataStr of parseSseStream(stream)) {
          if (signal?.aborted) {
            yield { type: 'error', error: 'Claude stream was cancelled.' };
            return;
          }
          rawCapture?.onChunk(dataStr);
          let data: any;
          try { data = JSON.parse(dataStr); } catch {
            yield { type: 'error', error: 'Claude stream contains an invalid JSON event.' };
            return;
          }
          if (!data || typeof data !== 'object' || Array.isArray(data)) {
            yield { type: 'error', error: 'Claude stream contains an invalid event.' };
            return;
          }
          try { tools.accept(data); } catch (err) {
            yield { type: 'error', error: (err as Error).message };
            return;
          }

          if (data.type === 'error') {
            yield { type: 'error', error: 'Claude stream reported an error.' };
            return;
          } else if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
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
            else if (sr != null) finishReason = 'stop';
            if (data.usage?.output_tokens) {
              outputTokens = data.usage.output_tokens;
              yield { type: 'usage', outputTokens };
            }
          } else if (data.type === 'message_start') {
            inputTokens = data.message?.usage?.input_tokens ?? 0;
          } else if (data.type === 'message_stop') {
            if (tools.hasTools || finishReason === 'tool_calls') {
              if (finishReason !== 'tool_calls' || !tools.hasTools) {
                yield { type: 'error', error: 'Claude tool turn ended without a complete tool_use response.' };
                return;
              }
              let calls;
              try { calls = tools.finish(); } catch (err) {
                yield { type: 'error', error: (err as Error).message };
                return;
              }
              for (const toolCall of calls) {
                if (signal?.aborted) break;
                yield { type: 'tool_call', toolCall };
              }
            }
            if (signal?.aborted) {
              yield { type: 'error', error: 'Claude stream was cancelled.' };
              return;
            }
            yield {
              type: 'done',
              finishReason,
              usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
            };
            return;
          }
        }
        yield { type: 'error', error: 'Claude stream ended before message_stop.' };
      } catch {
        yield { type: 'error', error: 'Claude stream was interrupted before completion.' };
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        await rawCapture?.onClose();
      }
    }
  };
}

/**
 * List model ids from the Anthropic /v1/models endpoint. baseUrl here is the
 * full versioned root (PROVIDER_CONFIGS.claude.baseUrl = '.../v1'), matching
 * what the chat client already POSTs `${baseUrl}/messages` to.
 */
export async function listAnthropicModels(input: {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${input.baseUrl}/models`, {
    method: 'GET',
    headers: {
      'x-api-key': input.apiKey ?? '',
      'anthropic-version': '2023-06-01'
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  const data = await response.json() as { data?: Array<{ id?: string }> };
  const models = (data.data ?? [])
    .map((m) => (typeof m.id === 'string' ? m.id.trim() : ''))
    .filter((id) => id.length > 0);
  return Array.from(new Set(models));
}
