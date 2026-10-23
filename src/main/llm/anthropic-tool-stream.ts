import type { ToolCall } from '@shared/llm-types';

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

interface PendingTool {
  id: string;
  name: string;
  initialInput: unknown;
  json?: string;
  arguments?: Record<string, unknown>;
}

/** Buffer a complete turn so a later malformed/truncated call cannot run an earlier one. */
export class AnthropicToolStream {
  private pending = new Map<number, PendingTool>();
  private ids = new Set<string>();

  get hasTools(): boolean { return this.pending.size > 0; }

  accept(event: Record<string, unknown>): void {
    const block = object(event.content_block);
    const delta = object(event.delta);
    if (event.type === 'content_block_start' && block?.type === 'tool_use') {
      const index = this.index(event.index);
      if (this.pending.has(index) || typeof block.id !== 'string' || !block.id.trim() ||
          typeof block.name !== 'string' || !block.name.trim() || this.ids.has(block.id)) {
        throw new Error('Invalid Claude tool block identity.');
      }
      this.ids.add(block.id);
      this.pending.set(index, { id: block.id, name: block.name, initialInput: block.input });
    } else if (event.type === 'content_block_delta' && delta?.type === 'input_json_delta') {
      const tool = this.pending.get(this.index(event.index));
      if (!tool || tool.arguments || typeof delta.partial_json !== 'string') {
        throw new Error('Unexpected Claude tool input fragment.');
      }
      tool.json = (tool.json ?? '') + delta.partial_json;
    } else if (event.type === 'content_block_stop' && typeof event.index === 'number') {
      const tool = this.pending.get(event.index);
      if (!tool) return; // Text/thinking blocks have their own handlers.
      if (tool.arguments) throw new Error('Duplicate Claude tool block completion.');
      let input: unknown;
      try {
        input = tool.json === undefined ? tool.initialInput : JSON.parse(tool.json);
      } catch {
        // Do not include raw model arguments in user-visible errors or app.log.
        throw new Error('Claude tool input is not valid JSON.');
      }
      tool.arguments = object(input);
      if (!tool.arguments) throw new Error('Claude tool input must be a JSON object.');
    }
  }

  finish(): ToolCall[] {
    return [...this.pending.values()].map((tool) => {
      if (!tool.arguments) throw new Error('Claude tool input was truncated before completion.');
      return { id: tool.id, name: tool.name, arguments: tool.arguments };
    });
  }

  private index(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error('Invalid Claude tool block index.');
    }
    return value;
  }
}
