import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../../src/shared/llm-types';
import { createAnthropicClient } from '../../src/main/llm/anthropic-client';

interface RequestBody {
  system?: string;
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
}

function message(role: Message['role'], content: string, extra: Partial<Message> = {}): Message {
  return { id: role, role, content, createdAt: '', ...extra };
}

async function captureRequest(messages: Message[]): Promise<RequestBody> {
  const bodies: RequestBody[] = [];
  const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as RequestBody);
    return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  });
  const client = createAnthropicClient({ baseUrl: 'https://example.test/v1', defaultModel: 'test', fetchImpl });
  for await (const event of client.stream({ providerId: 'claude', messages })) {
    expect(event.type).not.toBe('error');
  }
  expect(fetchImpl).toHaveBeenCalledOnce();
  return bodies[0];
}

const firstCall = { id: 'toolu_1', name: 'lookup_fields', arguments: { form: 'TEST', keys: ['FName'] } };
const secondCall = { id: 'toolu_2', name: 'lookup_plugins', arguments: {} };

describe('Anthropic request history replay (PR #16)', () => {
  it('pairs an empty-text assistant tool call with its following result', async () => {
    const messages = [
      message('user', 'Inspect the test form'),
      message('assistant', '', { toolCalls: [firstCall] }),
      message('tool', '{"fields":[]}', { toolCallId: firstCall.id }),
    ];
    const before = structuredClone(messages);
    const body = await captureRequest(messages);
    expect(body.messages[1]).toEqual({ role: 'assistant', content: [
      { type: 'tool_use', id: firstCall.id, name: firstCall.name, input: firstCall.arguments },
    ] });
    expect(body.messages[2]).toEqual({ role: 'user', content: [
      { type: 'tool_result', tool_use_id: firstCall.id, content: '{"fields":[]}' },
    ] });
    expect(messages).toEqual(before);
  });

  it('returns all parallel tool results in one user turn with their original IDs', async () => {
    const body = await captureRequest([
      message('user', 'Inspect'),
      message('assistant', 'Checking metadata', { toolCalls: [firstCall, secondCall] }),
      message('tool', 'fields', { toolCallId: firstCall.id }),
      message('tool', 'plugins', { toolCallId: secondCall.id }),
    ]);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'Checking metadata' },
      { type: 'tool_use', id: firstCall.id, name: firstCall.name, input: firstCall.arguments },
      { type: 'tool_use', id: secondCall.id, name: secondCall.name, input: {} },
    ]);
    expect(body.messages[2]).toEqual({ role: 'user', content: [
      { type: 'tool_result', tool_use_id: firstCall.id, content: 'fields' },
      { type: 'tool_result', tool_use_id: secondCall.id, content: 'plugins' },
    ] });
  });

  it.each(['', 'Let me inspect'])('preserves signed thinking before text and tool use (%s)', async (content) => {
    const body = await captureRequest([
      message('user', 'Inspect'),
      message('assistant', content, {
        reasoningContent: 'Reasoning with whitespace \n',
        reasoningSignature: 'opaque-signature',
        toolCalls: [firstCall],
      }),
      message('tool', '[]', { toolCallId: firstCall.id }),
    ]);
    expect(body.messages[1].content).toEqual([
      { type: 'thinking', thinking: 'Reasoning with whitespace \n', signature: 'opaque-signature' },
      ...(content ? [{ type: 'text', text: content }] : []),
      { type: 'tool_use', id: firstCall.id, name: firstCall.name, input: firstCall.arguments },
    ]);
  });

  it('keeps plain conversation and system extraction unchanged', async () => {
    const body = await captureRequest([
      message('system', 'System instruction'),
      message('user', 'Hello'),
      message('assistant', 'Hello back', { reasoningContent: 'unsigned reasoning' }),
    ]);
    expect(body.system).toBe('System instruction');
    expect(body.messages).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hello back' },
    ]);
  });

  it('does not combine results across an intervening assistant turn', async () => {
    const body = await captureRequest([
      message('user', 'Inspect'),
      message('assistant', '', { toolCalls: [firstCall] }),
      message('tool', 'fields', { toolCallId: firstCall.id }),
      message('assistant', '', { toolCalls: [secondCall] }),
      message('tool', 'plugins', { toolCallId: secondCall.id }),
    ]);
    expect(body.messages).toHaveLength(5);
    expect(body.messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: firstCall.id, content: 'fields' },
    ]);
    expect(body.messages[4].content).toEqual([
      { type: 'tool_result', tool_use_id: secondCall.id, content: 'plugins' },
    ]);
  });
});
