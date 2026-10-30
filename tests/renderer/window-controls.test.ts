// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WindowControls } from '../../src/renderer/components/WindowControls';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let root: Root;
let host: HTMLDivElement;
let listener: (maximized: boolean) => void;
let resolveInitial: (maximized: boolean) => void;
const off = vi.fn();
const api = {
  winIsMaximized: vi.fn(),
  winOnMaximized: vi.fn((callback: typeof listener) => { listener = callback; return off; }),
  winMinimize: vi.fn().mockResolvedValue(undefined),
  winToggleMaximize: vi.fn().mockResolvedValue(undefined),
  winClose: vi.fn().mockResolvedValue(undefined),
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(window, { opendeploy: api });
  api.winIsMaximized.mockReturnValue(new Promise<boolean>((resolve) => { resolveInitial = resolve; }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); });
const mount = async () => { await act(async () => root.render(createElement(WindowControls))); };
const maximizeButton = () => host.querySelectorAll('button')[1];

describe('WindowControls runtime state', () => {
  it('announces Restore when maximized and Maximize after restoring', async () => {
    await mount();
    await act(async () => resolveInitial(true));
    expect(maximizeButton().getAttribute('aria-label')).toBe('titlebar.restore');
    expect(maximizeButton().title).toBe('titlebar.restore');
    await act(async () => listener(false));
    expect(maximizeButton().getAttribute('aria-label')).toBe('titlebar.maximize');
  });
  it('keeps a newer native event when the initial query resolves late', async () => {
    await mount();
    await act(async () => listener(true));
    await act(async () => resolveInitial(false));
    expect(maximizeButton().getAttribute('aria-label')).toBe('titlebar.restore');
  });
  it('recovers from a failed initial query on the next native event', async () => {
    api.winIsMaximized.mockRejectedValueOnce(new Error('synthetic IPC error'));
    await mount();
    await act(async () => listener(true));
    expect(maximizeButton().getAttribute('aria-label')).toBe('titlebar.restore');
  });
  it('wires the three native button actions and releases its subscription', async () => {
    await mount();
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.type).toBe('button');
      expect(button.tabIndex).toBe(0);
      await act(async () => button.click());
    }
    expect(api.winMinimize).toHaveBeenCalledOnce();
    expect(api.winToggleMaximize).toHaveBeenCalledOnce();
    expect(api.winClose).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    expect(off).toHaveBeenCalledOnce();
    await act(async () => resolveInitial(true));
    expect(host.childElementCount).toBe(0);
  });
});
