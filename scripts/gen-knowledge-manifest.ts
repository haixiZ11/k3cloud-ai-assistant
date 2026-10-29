/**
 * Rebuild `knowledge/manifest.json` from the on-disk skills tree.
 *
 * Run via `pnpm knowledge:manifest` using the project's tsx dependency.
 *
 * Each skill's digest covers SKILL.md plus every `.md` under `prompts/`
 * and `references/` — so changes to supporting files are integrity-checked
 * alongside the index. Algorithm: hash each file, concatenate
 * `<relative-path>:<file-sha>\n` in sorted order, then hash that.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');
const BUNDLE_VERSION = process.env.BUNDLE_VERSION ?? '0.1.0';

/**
 * SHA-256 of a skill content file. Rejects CRLF instead of hashing it.
 *
 * .gitattributes pins every .md under knowledge/ to eol=lf, so a checkout must
 * be LF here. A CRLF file means the working tree diverged from what the repo
 * promises (stale checkout, core.autocrlf=true without re-normalization) --
 * hashing it would write a digest only this machine can reproduce, so fail
 * loudly and point at the fix.
 *
 * The runtime counterpart hashNormalizedFile in src/main/skills/integrity.ts
 * strips CRLF before hashing as a safety net for end users (they get whatever
 * bytes shipped in the asar). With LF input both produce the same digest, so
 * the manifest written here still verifies there.
 */
async function hashFile(p: string): Promise<string> {
  const bytes = await fs.readFile(p);
  if (bytes.includes(Buffer.from('\r\n'))) {
    throw new Error(
      `Knowledge files must use LF line endings before generating the manifest: ${p}\n` +
        'Fix: git add --renormalize knowledge/ (or set core.autocrlf=input), then re-run pnpm knowledge:manifest.'
    );
  }
  return createHash('sha256').update(bytes).digest('hex');
}

async function listSkillFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const top = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of top) {
    if (entry.isFile() && entry.name === 'SKILL.md') {
      files.push('SKILL.md');
    } else if (entry.isDirectory() && (entry.name === 'prompts' || entry.name === 'references')) {
      const sub = await fs.readdir(path.join(dir, entry.name)).catch(() => []);
      for (const name of sub) {
        if (name.endsWith('.md')) files.push(`${entry.name}/${name}`);
      }
    }
  }
  return files.sort();
}

async function hashSkillDirectory(dir: string): Promise<string> {
  const rel = await listSkillFiles(dir);
  const entries: string[] = [];
  for (const r of rel) {
    entries.push(`${r}:${await hashFile(path.join(dir, r))}\n`);
  }
  return createHash('sha256').update(entries.join('')).digest('hex');
}

async function main(): Promise<void> {
  const skillsRoot = path.join(ROOT, 'skills');
  const namespaces = await fs.readdir(skillsRoot);
  const entries: Array<{ id: string; version: string; sha256: string }> = [];

  for (const ns of namespaces) {
    const nsDir = path.join(skillsRoot, ns);
    if (!(await fs.stat(nsDir)).isDirectory()) continue;

    for (const name of await fs.readdir(nsDir)) {
      const skillDir = path.join(nsDir, name);
      const stat = await fs.stat(skillDir).catch(() => null);
      if (!stat?.isDirectory()) continue;

      const file = path.join(skillDir, 'SKILL.md');
      const src = await fs.readFile(file, 'utf8').catch(() => null);
      if (src == null) continue;

      const version = /^version:\s*(\S+)$/m.exec(src)?.[1]?.replace(/['"]/g, '') ?? '0.0.0';
      const sha256 = await hashSkillDirectory(skillDir);
      entries.push({ id: `${ns}/${name}`, version, sha256 });
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  const manifest = {
    schema: '1' as const,
    version: BUNDLE_VERSION,
    skills: entries
  };
  const out = path.join(ROOT, 'manifest.json');
  await fs.writeFile(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`wrote ${out} with ${entries.length} skill(s), bundle version ${BUNDLE_VERSION}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
