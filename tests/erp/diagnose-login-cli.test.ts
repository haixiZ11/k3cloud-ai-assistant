import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

let home: string;
beforeEach(async () => { home = await fs.mkdtemp(join(tmpdir(), 'opendeploy-diagnostic-')); });
afterEach(async () => { await fs.rm(home, { recursive: true, force: true }); });

describe('login diagnostic CLI output and file logs', () => {
  it.each(['success', 'exception', 'envelope'])(
    'withholds private output on %s through the real entry point', async (scenario) => {
      const result = spawnSync(process.execPath, [
        '--import', pathToFileURL(resolve('tests/erp/fixtures/diagnostic-fetch.mjs')).href,
        '--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href,
        'scripts/bos-recon/diagnose-login.ts',
      ], {
        encoding: 'utf8', timeout: 15000,
        env: {
          ...process.env, OPENDEPLOY_HOME: home, DIAGNOSTIC_FIXTURE_CASE: scenario,
          K3_BASE_URL: 'https://example.test/k3cloud', K3_ACCT_ID: 'synthetic-account',
          K3_USERNAME: 'synthetic-user', K3_PASSWORD: 'synthetic-password',
        },
      });
      expect(result.status, result.stderr).toBe(scenario === 'success' ? 0 : 1);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({
        status: scenario === 'success' ? 'accepted' : 'login_failed',
        dataCenterCount: 1, configuredAccountPresent: true, passwordMode: 'obfuscation',
        ...(scenario === 'success' ? { loginResultType: 1 } : {}),
      });
      expect(result.stdout).not.toContain('SYNTHETIC-CLI-PRIVATE');
      // Exercise the real logger, not a mock: the diagnostic must leave no log files.
      expect(await fs.readdir(home)).toEqual([]);
    },
  );
});
