import { describe, expect, it, vi } from 'vitest';
import { createAnthropicClient } from '../../src/main/llm/anthropic-client';
import { runAgentLoop } from '../../src/main/agent/loop';
import { ToolRegistry } from '../../src/main/agent/tools';
import type { StreamEvent } from '../../src/shared/llm-types';

vi.mock('../../src/main/logger', () => ({
  createLogger: () => ({ error: vi.fn(), trace: vi.fn() }),
}));

const start = (index = 0, id = 'call-1', name = 'echo') => ({
  type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} },
});
const delta = (partial_json: string, index = 0) => ({
  type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json },
});
const stop = (index = 0) => ({ type: 'content_block_stop', index });
const finish = (stop_reason = 'tool_use') => [
  { type: 'message_delta', delta: { stop_reason }, usage: { output_tokens: 12 } },
  { type: 'message_stop' },
];

function response(events: unknown[]): Response {
  const bytes = new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''));
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) return controller.close();
      // Split JSON, SSE boundaries, and multibyte characters across transport chunks.
      controller.enqueue(bytes.slice(offset, offset + 7));
      offset = Math.min(offset + 7, bytes.length);
    },
  }));
}

async function collect(events: unknown[]) {
  const client = createAnthropicClient({
    baseUrl: 'https://example.test', defaultModel: 'test', fetchImpl: async () => response(events),
  });
  const capture = { onRequest: vi.fn(), onChunk: vi.fn(), onClose: vi.fn(async () => {}) };
  const output: StreamEvent[] = [];
  for await (const event of client.stream({ providerId: 'claude', messages: [] }, { rawCapture: capture })) {
    output.push(event);
  }
  expect(capture.onClose).toHaveBeenCalledOnce();
  return output;
}

describe('Anthropic streamed tool inputs', () => {
  it('assembles fragmented arguments and emits the complete call before done', async () => {
    const output = await collect([
      start(), delta('{"text":'), delta('"你好","nested":{"a":[1,true]}}'), stop(), ...finish(),
    ]);
    expect(output.filter((e) => e.type === 'tool_call')).toEqual([
      { type: 'tool_call', toolCall: { id: 'call-1', name: 'echo', arguments: { text: '你好', nested: { a: [1, true] } } } },
    ]);
    expect(output.at(-1)).toMatchObject({ type: 'done', finishReason: 'tool_calls' });
  });

  it('keeps multiple calls separate and supports an empty argument object', async () => {
    const output = await collect([
      start(2, 'first'), delta('{"text":"one"}', 2), stop(2),
      start(5, 'second'), stop(5), ...finish(),
    ]);
    expect(output.filter((e) => e.type === 'tool_call')).toEqual([
      { type: 'tool_call', toolCall: { id: 'first', name: 'echo', arguments: { text: 'one' } } },
      { type: 'tool_call', toolCall: { id: 'second', name: 'echo', arguments: {} } },
    ]);
  });

  it.each(['{"secret":', '[]', 'null', '42'])(
    'rejects malformed or non-object input without emitting any tool call (%s)', async (input) => {
      const output = await collect([
        start(0, 'valid'), delta('{}'), stop(),
        start(1, 'invalid'), delta(input, 1), stop(1), ...finish(),
      ]);
      expect(output.some((e) => e.type === 'error')).toBe(true);
      expect(output.some((e) => e.type === 'tool_call')).toBe(false);
      expect(JSON.stringify(output)).not.toContain('secret');
    },
  );

  it.each([
    [start(), delta('{}'), ...finish()],
    [start(), delta('{}'), stop()],
    [start(), delta('{}'), stop(), ...finish('max_tokens')],
    [start(), delta('{}'), stop(), { type: 'error', error: { message: 'private provider details' } }],
    [start(), stop(), start(1), stop(1), ...finish()],
    [delta('{}'), stop(), ...finish()],
  ])('does not emit calls from incomplete, rejected or inconsistent streams (%#)', async (...events) => {
    const output = await collect(events);
    expect(output.some((e) => e.type === 'error')).toBe(true);
    expect(output.some((e) => e.type === 'tool_call')).toBe(false);
  });

  it('runs a two-round agent conversation using the real adapter and a fake transport', async () => {
    const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)));
      return requests.length === 1
        ? response([start(), delta('{"text":"hello"}'), stop(), ...finish()])
        : response([
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Finished' } },
          ...finish('end_turn'),
        ]);
    });
    const execute = vi.fn(async (args: Record<string, unknown>) => `echoed:${args.text}`);
    const tools = new ToolRegistry();
    tools.register({
      parallelSafe: true,
      definition: { name: 'echo', description: 'test only', parameters: { type: 'object', properties: {} } },
      execute,
    });
    const messages = await runAgentLoop({
      client: createAnthropicClient({ baseUrl: 'https://example.test', defaultModel: 'test', fetchImpl }),
      tools, providerId: 'claude', maxIterations: 2,
      initialMessages: [{ id: 'u', role: 'user', content: 'hello', createdAt: '' }],
    });
    expect(execute).toHaveBeenCalledExactlyOnceWith({ text: 'hello' });
    expect(requests).toHaveLength(2);
    expect(requests[1].messages[1].content).toEqual([
      { type: 'tool_use', id: 'call-1', name: 'echo', input: { text: 'hello' } },
    ]);
    expect(requests[1].messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'call-1', content: 'echoed:hello' },
    ]);
    expect(messages.at(-1)?.content).toBe('Finished');
  });

  it('retains tool_use stop reason across a later usage-only event', async () => {
    const output = await collect([
      start(), stop(), finish()[0],
      { type: 'message_delta', delta: { stop_reason: null }, usage: { output_tokens: 15 } },
      { type: 'message_stop' },
    ]);
    expect(output.at(-1)).toMatchObject({ type: 'done', finishReason: 'tool_calls' });
  });

  it('does not execute a completed call if a later call in the same turn is invalid', async () => {
    const execute = vi.fn(async () => 'must not run');
    const tools = new ToolRegistry();
    tools.register({
      parallelSafe: true,
      definition: { name: 'echo', description: '', parameters: { type: 'object', properties: {} } }, execute,
    });
    const messages = await runAgentLoop({
      client: createAnthropicClient({ baseUrl: 'https://example.test', defaultModel: 'test',
        fetchImpl: async () => response([
          start(), delta('{}'), stop(), start(1, 'invalid'), delta('{', 1), stop(1), ...finish(),
        ]) }),
      tools, providerId: 'claude', initialMessages: [], maxIterations: 1,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(messages.at(-1)?.errored).toBe(true);
  });

  it('reports cancellation before done and closes capture when aborted during delivery', async () => {
    const controller = new AbortController();
    const client = createAnthropicClient({ baseUrl: 'https://example.test', defaultModel: 'test',
      fetchImpl: async () => response([start(), stop(), ...finish()]) });
    const capture = { onRequest: vi.fn(), onChunk: vi.fn(), onClose: vi.fn(async () => {}) };
    const output: StreamEvent[] = [];
    for await (const event of client.stream({ providerId: 'claude', messages: [] }, {
      abortSignal: controller.signal, rawCapture: capture,
    })) {
      output.push(event);
      if (event.type === 'tool_call') controller.abort();
    }
    expect(output.at(-1)).toMatchObject({ type: 'error' });
    expect(output.some((e) => e.type === 'done')).toBe(false);
    expect(capture.onClose).toHaveBeenCalledOnce();
  });

  it.each(['capture-close', 'first-tool'])(
    'does not dispatch queued tools after cancellation during %s', async (cancelAt) => {
      const controller = new AbortController();
      const fetchImpl = vi.fn(async () => response([
        start(0, 'first'), stop(0), start(1, 'second'), stop(1), ...finish(),
      ]));
      const execute = vi.fn(async () => {
        controller.abort();
        return 'first completed';
      });
      const tools = new ToolRegistry();
      tools.register({
        parallelSafe: false,
        definition: { name: 'echo', description: '', parameters: { type: 'object', properties: {} } },
        execute,
      });
      const events: Array<{ type: string; isError?: boolean }> = [];
      const messages = await runAgentLoop({
        client: createAnthropicClient({ baseUrl: 'https://example.test', defaultModel: 'test', fetchImpl }),
        tools, providerId: 'claude', initialMessages: [], maxIterations: 2,
        signal: controller.signal, onEvent: (event) => events.push(event),
        rawCaptureFactory: () => ({
          onRequest: vi.fn(), onChunk: vi.fn(),
          onClose: async () => { if (cancelAt === 'capture-close') controller.abort(); },
        }),
      });
      expect(execute).toHaveBeenCalledTimes(cancelAt === 'capture-close' ? 0 : 1);
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId)).toEqual(['first', 'second']);
      expect(messages.at(-1)?.content).toBe('Tool call cancelled before execution.');
      expect(events.filter((e) => e.type === 'tool_result').at(-1)?.isError).toBe(true);
      expect(events.at(-1)?.type).toBe('done');
    },
  );

  it('turns a transport failure into an error and closes capture', async () => {
    const client = createAnthropicClient({ baseUrl: 'https://example.test', defaultModel: 'test',
      fetchImpl: async () => new Response(new ReadableStream({
        pull(controller) { controller.error(new Error('connection lost')); },
      })) });
    const capture = { onRequest: vi.fn(), onChunk: vi.fn(), onClose: vi.fn(async () => {}) };
    const output: StreamEvent[] = [];
    for await (const event of client.stream({ providerId: 'claude', messages: [] }, { rawCapture: capture })) {
      output.push(event);
    }
    expect(output).toEqual([{ type: 'error', error: 'Claude stream was interrupted before completion.' }]);
    expect(capture.onClose).toHaveBeenCalledOnce();
  });
});
