import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Wizard drag-region contract (frameless window regression guard).
 *
 * Background: `frame: false` removes the native Windows caption, so the
 * window can only be moved via `-webkit-app-region: drag` surfaces. The
 * first-run wizard hides the in-app TitleBar, so it MUST provide its own
 * drag surface (`wiz-dragbar`) with the caption buttons opted out
 * (`no-drag`). Before this contract existed, the wizard had zero drag
 * area and a first-time user could not move the window at all.
 *
 * ── Manual verification checklist (run before merging) ──────────────
 * These behaviors are OS-level and cannot be asserted in vitest's node
 * environment; verify once by hand on Windows:
 *
 *   1. `set OPENDEPLOY_HOME=%TEMP%\od-fresh` (or delete `~/.opendeploy`
 *      / settings.json) → `pnpm dev` → wizard shows on first run.
 *   2. Drag the empty strip above the wizard card → window moves.
 *   3. Double-click the same strip → toggles maximize / restore.
 *   4. While maximized, drag the strip → window restores and follows
 *      the cursor (Windows snap behavior).
 *   5. The three caption buttons (min / max / close) still click —
 *      they must NOT start a window drag.
 *   6. Resize to the 900×600 minimum → the drag strip and card never
 *      overlap; the card's scrollbar still works (the scroll container
 *      is NOT part of the drag region).
 *   7. Complete the wizard → main TitleBar drag still works.
 * ─────────────────────────────────────────────────────────────────────
 */

const css = readFileSync(
  resolve('src/renderer/styles/design-system.css'),
  'utf-8'
);
const appTsx = readFileSync(resolve('src/renderer/App.tsx'), 'utf-8');

/** Strip block comments first so selector parsing sees bare rules. */
const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Extract the body of the rule whose selector list (comma-separated)
 * contains `selector` exactly — e.g. `.wiz-dragbar button` also matches
 * the grouped rule `.wiz-dragbar button, .wiz-dragbar .wincaps { … }`.
 */
function ruleBody(selector: string): string | undefined {
  for (const chunk of cssBare.split('}')) {
    const open = chunk.indexOf('{');
    if (open === -1) continue;
    const selectors = chunk.slice(0, open).split(',').map((s) => s.trim());
    if (selectors.includes(selector)) return chunk.slice(open + 1);
  }
  return undefined;
}

describe('wizard drag region (frameless window)', () => {
  it('mode-wizard reserves a real 40px titlebar row, not a collapsed one', () => {
    const body = ruleBody('.app.mode-wizard');
    expect(body, '.app.mode-wizard rule missing from design-system.css').toBeDefined();
    // The pre-fix bug: rows were `0 1fr 0`, so the dragbar had zero height
    // and the wizard had no drag surface at all.
    expect(body).toMatch(/grid-template-rows:\s*40px\s+1fr\s+0/);
  });

  it('.wiz-dragbar occupies the titlebar grid area and is a drag region', () => {
    const body = ruleBody('.wiz-dragbar');
    expect(body, '.wiz-dragbar rule missing from design-system.css').toBeDefined();
    expect(body).toMatch(/grid-area:\s*titlebar/);
    expect(body).toMatch(/-webkit-app-region:\s*drag/);
  });

  it('.wiz-dragbar interactive descendants opt out of dragging', () => {
    // Buttons inside a drag region are unclickable unless they are
    // explicitly no-drag — the captions must stay usable.
    const btn = ruleBody('.wiz-dragbar button');
    expect(btn, '.wiz-dragbar button rule missing').toBeDefined();
    expect(btn).toMatch(/-webkit-app-region:\s*no-drag/);

    const caps = ruleBody('.wiz-dragbar .wincaps');
    expect(caps, '.wiz-dragbar .wincaps rule missing').toBeDefined();
    expect(caps).toMatch(/-webkit-app-region:\s*no-drag/);
  });

  it('App renders the dragbar with captions on the wizard page', () => {
    // The wizard branch must render the dragbar (not just the captions)
    // and the WindowControls must live inside it.
    expect(appTsx).toMatch(
      /\{isWizard && \(\s*<div className="wiz-dragbar">\s*<WindowControls \/>\s*<\/div>\s*\)\}/
    );
  });

  it('the old fixed float cluster is fully removed', () => {
    // wincontrols-float was position:fixed with no drag handling — it
    // overlapped scrollable content and left the window unmovable.
    expect(appTsx).not.toContain('wincontrols-float');
    expect(css).not.toContain('wincontrols-float');
  });

  it('main TitleBar keeps its own drag region (no cross-regression)', () => {
    const bar = ruleBody('.titlebar');
    expect(bar).toBeDefined();
    expect(bar).toMatch(/-webkit-app-region:\s*drag/);

    const caps = ruleBody('.titlebar .wincaps');
    expect(caps).toBeDefined();
    expect(caps).toMatch(/-webkit-app-region:\s*no-drag/);
  });
});
