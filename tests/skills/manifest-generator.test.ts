import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashSkillDirectory } from '../../src/main/skills/integrity';

let root: string;
let skillDir: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'opendeploy-manifest-'));
  skillDir = join(root, 'knowledge/skills/common/test');
  await fs.mkdir(join(skillDir, 'references'), { recursive: true });
  await fs.mkdir(join(root, 'scripts'));
  await fs.copyFile(resolve('scripts/gen-knowledge-manifest.ts'), join(root, 'scripts/generate.ts'));
  await fs.writeFile(join(skillDir, 'SKILL.md'), '---\nname: test\ndescription: test\nversion: 1.0.0\n---\nBody\n');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function generate() {
  return spawnSync(process.execPath, ['--experimental-strip-types', join(root, 'scripts/generate.ts')], {
    encoding: 'utf8', env: { ...process.env, BUNDLE_VERSION: 'test-version' },
  });
}

describe('knowledge manifest generation', () => {
  it('matches runtime byte integrity for index and reference files', async () => {
    await fs.writeFile(join(skillDir, 'references/example.md'), 'Reference\n');
    const result = generate();
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(await fs.readFile(join(root, 'knowledge/manifest.json'), 'utf8'));
    expect(manifest.version).toBe('test-version');
    expect(manifest.skills).toEqual([
      { id: 'common/test', version: '1.0.0', sha256: await hashSkillDirectory(skillDir) },
    ]);
  });

  it('rejects CRLF input without overwriting the existing manifest', async () => {
    await fs.writeFile(join(skillDir, 'references/example.md'), 'Reference\r\n');
    const manifestPath = join(root, 'knowledge/manifest.json');
    await fs.writeFile(manifestPath, 'previous-manifest');
    const result = generate();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('LF line endings');
    expect(result.stderr).toContain('example.md');
    expect(await fs.readFile(manifestPath, 'utf8')).toBe('previous-manifest');
  });
});
