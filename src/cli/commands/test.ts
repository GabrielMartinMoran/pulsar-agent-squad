import { defineCommand } from 'citty';
import { parseManifest } from '../lib/manifest';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'bun';
import { join } from 'path';
import { injectSkillPoliciesFromConfig } from '../lib/skill-injection';

function rmrf(path: string): void {
  if (!path) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function agentNameFromDestFile(destFile: string): string | null {
  const base = destFile.split('/').pop() ?? '';
  if (base === 'pas_developer.md') return 'pas_developer';
  if (base === 'pas_qa.md') return 'pas_qa';
  if (base === 'pas_researcher.md') return 'pas_researcher';
  if (base === 'Pulsar Agent Squad.md') return 'Pulsar Agent Squad';
  if (base === 'Pulsar Turbo.md') return 'Pulsar Turbo';
  return null;
}

function processAgentFile(sourceFile: string, destFile: string): void {
  let content = readFileSync(sourceFile, 'utf-8');

  const agentName = agentNameFromDestFile(destFile);
  if (agentName) {
    content = injectSkillPoliciesFromConfig(agentName, content);
  }

  writeFileSync(destFile, content);
}

function buildDirEntry(entry: { source: string; distPath: string; target: string }): void {
  const sourceDir = entry.source;
  const destDir = `dist/${entry.distPath}`;
  mkdirSync(destDir, { recursive: true });
  const files = readdirSync(sourceDir);
  for (const file of files) {
    const srcPath = `${sourceDir}/${file}`;
    const destPath = `${destDir}/${file}`;
    processAgentFile(srcPath, destPath);
  }
}

function buildFileEntry(entry: { source: string; distPath: string; target: string }): void {
  const destPath = `dist/${entry.distPath}`;
  mkdirSync(join(destPath, '..'), { recursive: true });
  // Byte copy (same semantics as `pas build`): no text decoding, no
  // skill injection — only canonical agent basenames get injected.
  writeFileSync(destPath, readFileSync(entry.source));
}

export const testCommand = defineCommand({
  meta: {
    name: 'test',
    description: 'Build opencode and run contract tests',
  },
  async run() {
    // Step 1: Build the opencode target. Every opencode row in the manifest
    // is rebuilt (agents dir + pas-toolkit plugin), replicating the `pas build
    // --target=opencode` semantics: clean dist/platforms/opencode once, then
    // process each entry (dir -> first-level files with skill injection for
    // canonical agent basenames; file -> byte copy).
    const entries = parseManifest();
    const opencodeEntries = entries.filter((e) => e.target === 'opencode');
    if (opencodeEntries.length === 0) {
      console.error('ERROR: opencode target not found in manifest');
      process.exit(1);
    }

    rmrf('dist/platforms/opencode');
    for (const entry of opencodeEntries) {
      if (entry.kind === 'dir') {
        buildDirEntry(entry);
      } else {
        buildFileEntry(entry);
      }
    }

    // Step 2: Run all 16 contract test scripts
    const testDir = 'tests';
    const testFiles = readdirSync(testDir)
      .filter((f) => f.endsWith('.sh'))
      .sort();

    let totalPass = 0;
    let totalFail = 0;

    for (const testFile of testFiles) {
      const testPath = join(testDir, testFile);
      const result = spawnSync(['bash', testPath], {
        cwd: process.cwd(),
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Check if output or stderr contains PASS/FAIL indicators
      const output = result.stdout.toString() + result.stderr.toString();

      if (result.exitCode === 0 && output.includes('PASS')) {
        console.log(`PASS: ${testFile}`);
        totalPass++;
      } else {
        console.log(`FAIL: ${testFile}`);
        totalFail++;
      }
    }

    console.log('');
    console.log(`Tests: ${totalPass} passed, ${totalFail} failed`);

    if (totalFail > 0) {
      process.exit(1);
    }
  },
});
