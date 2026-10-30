import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

// Capture handlers registered via ipcMain.handle so we can invoke them directly
type IpcHandler = (event: unknown, req: unknown) => Promise<unknown>;
const handlerMap = new Map<string, IpcHandler>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      handlerMap.set(channel, handler);
    }
  }
}));

const runAgentLoopMock = vi.fn().mockResolvedValue([]);
vi.mock('../../src/main/agent/loop', () => ({
  runAgentLoop: (...args: unknown[]) => runAgentLoopMock(...args)
}));

const loadSettingsMock = vi.fn();
vi.mock('../../src/main/settings', () => ({ loadSettings: () => loadSettingsMock() }));
vi.mock('../../src/main/logger', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock('../../src/main/agent/tools', () => ({
  ToolRegistry: class {
    register(): void {}
    definitions(): unknown[] { return []; }
  }
}));
vi.mock('../../src/main/agent/builtin-tools', () => ({ BUILTIN_TOOLS: [] }));
vi.mock('../../src/main/agent/skills-integration', () => ({
  buildSkillsContext: vi.fn().mockResolvedValue({
    systemPromptFragment: '',
    loadSkillTool: { name: 'load_skill' },
    loadSkillFileTool: { name: 'load_skill_file' }
  })
}));
vi.mock('../../src/main/agent/k3cloud-tools', () => ({
  activeProjectTag: () => '',
  buildK3CloudTools: () => []
}));
vi.mock('../../src/main/agent/erp-rules', () => ({
  erpRulesFragment: () => ''
}));
vi.mock('../../src/main/erp/active', () => ({
  getConnectionState: () => ({ projectId: null, erpProvider: null })
}));
vi.mock('../../src/main/projects/store', () => ({ getProject: vi.fn() }));
vi.mock('../../src/main/agent/plugin-tools', () => ({ buildPluginTools: () => [] }));
vi.mock('../../src/main/agent/plan-tools', () => ({ buildPlanTools: () => [] }));
vi.mock('../../src/main/agent/bos-rpc-tools', () => ({
  buildBosRpcTools: vi.fn().mockResolvedValue([])
}));
vi.mock('../../src/main/conversations/store', () => ({
  loadConversation: vi.fn(),
  saveConversation: vi.fn().mockResolvedValue(undefined),
  listConversations: vi.fn(),
  deleteConversation: vi.fn()
}));

// Vite ?raw imports become string default exports at runtime
vi.mock('../../src/main/agent/prompts/base-system.md?raw', () => ({ default: 'base' }));
vi.mock('../../src/main/agent/prompts/erp-rules/k3cloud.md?raw', () => ({ default: 'k3' }));
vi.mock('../../src/main/agent/prompts/active-project-tag.md?raw', () => ({ default: 'tag' }));
vi.mock('../../src/main/agent/prompts/skills-catalog-intro.md?raw', () => ({ default: 'intro' }));

import { registerLlmIpc } from '../../src/main/ipc-llm';

describe('ipc-llm — model 透传', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    handlerMap.clear();
    runAgentLoopMock.mockReset();
    runAgentLoopMock.mockResolvedValue([]);
    loadSettingsMock.mockResolvedValue({ llmRawDump: false });
    vi.unstubAllGlobals();
    registerLlmIpc(() => null);
  });

  it('forwards req.model to runAgentLoop', async () => {
    const handler = handlerMap.get('llm:send')!;
    expect(handler).toBeDefined();
    await handler(null, {
      providerId: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-v4-pro',
      userMessage: 'hi'
    });
    // Handler launches the agent loop in a void IIFE; let the microtask queue drain.
    await new Promise((r) => setTimeout(r, 30));
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'deepseek',
        apiKey: 'sk-test',
        model: 'deepseek-v4-pro'
      })
    );
  });

  it('passes model: undefined when payload omits it', async () => {
    const handler = handlerMap.get('llm:send')!;
    await handler(null, {
      providerId: 'claude',
      apiKey: 'sk-ant',
      userMessage: 'hi'
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(runAgentLoopMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'claude', model: undefined })
    );
  });

  it.each([undefined, '', 'https://synthetic-override.test/api/v3'])(
    'constructs and streams the custom OpenAI chat client with override %s', async (override) => {
      loadSettingsMock.mockResolvedValue({
        llmRawDump: false,
        customOpenAI: { baseUrl: 'https://synthetic-gateway.test/v1', model: 'synthetic-model' },
        apiBaseUrlOverride: { 'custom-openai': override },
      });
      const fetchMock = vi.fn().mockResolvedValue(new Response(
        'data: {"choices":[{"delta":{"content":"mock reply"}}]}\n\ndata: [DONE]\n\n',
      ));
      vi.stubGlobal('fetch', fetchMock);
      const events: unknown[] = [];
      runAgentLoopMock.mockImplementationOnce(async (options) => {
        for await (const event of options.client.stream({
          providerId: options.providerId, apiKey: options.apiKey, model: options.model,
          messages: options.initialMessages,
        })) events.push(event);
        return options.initialMessages;
      });
      await handlerMap.get('llm:send')!(null, {
        providerId: 'custom-openai', apiKey: 'synthetic-key', userMessage: 'synthetic hello',
      });
      await vi.waitFor(() => expect(events).toContainEqual({ type: 'delta', content: 'mock reply' }));
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${override || 'https://synthetic-gateway.test/v1'}/chat/completions`);
      expect(JSON.parse(init.body).model).toBe('synthetic-model');
      expect(init.headers.Authorization).toBe('Bearer synthetic-key');
    },
  );
  it.each([
    { model: 'synthetic-model' },
    { baseUrl: 'https://synthetic.test/v1' },
  ])('rejects incomplete custom configuration before any chat request', async (customOpenAI) => {
    loadSettingsMock.mockResolvedValue({ llmRawDump: false, customOpenAI });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const send = vi.fn();
    registerLlmIpc(() => ({ webContents: { send } }) as unknown as BrowserWindow);
    await handlerMap.get('llm:send')!(null, { providerId: 'custom-openai', userMessage: 'synthetic' });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('llm:stream', expect.objectContaining({ type: 'error' })));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(runAgentLoopMock).not.toHaveBeenCalled();
  });
});
