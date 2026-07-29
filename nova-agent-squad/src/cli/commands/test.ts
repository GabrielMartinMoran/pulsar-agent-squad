import { defineCommand } from 'citty';
import { parseManifest } from '../lib/manifest';
import { Eta } from 'eta';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'bun';
import { join } from 'path';

// Minimal build logic imported from build.ts pattern
const eta = new Eta({ autoTrim: false });

function rmrf(path: string): void {
  if (!path) return;
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function getCavemanContent(agent: 'developer' | 'qa'): string {
  const templatePath = `${import.meta.dir}/../templates/nas_caveman.eta`;
  const template = readFileSync(templatePath, 'utf-8');
  return eta.renderString(template, { agent });
}

function getDeveloperSharedContent(agent: 'developer' | 'developer_mini', section: string): string {
  const templatePath = `${import.meta.dir}/../templates/nas_developer_shared.eta`;
  const template = readFileSync(templatePath, 'utf-8');
  return eta.renderString(template, { agent, section });
}

function detectDeveloperAgent(sourceFile: string): 'developer' | 'developer_mini' | null {
  const fileName = sourceFile.split('/').pop();
  if (fileName === 'nas_developer.md') return 'developer';
  if (fileName === 'nas_developer_mini.md') return 'developer_mini';
  return null;
}

function processAgentFile(sourceFile: string, destFile: string): void {
  let content = readFileSync(sourceFile, 'utf-8');
  const devAgent = detectDeveloperAgent(sourceFile);

  if (content.includes('INJECT:caveman_developer')) {
    const cavemanContent = getCavemanContent('developer');
    content = content.replace(`<!-- INJECT:caveman_developer -->\n`, cavemanContent);
  } else if (content.includes('INJECT:caveman_qa')) {
    const cavemanContent = getCavemanContent('qa');
    content = content.replace(`<!-- INJECT:caveman_qa -->\n`, cavemanContent);
  }

  if (devAgent && content.includes('INJECT:developer_shared')) {
    const markerPattern = /<!-- INJECT:developer_shared_(\w+) -->\n/g;
    content = content.replace(markerPattern, (_match, section) => {
      return getDeveloperSharedContent(devAgent, section);
    });
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
  const content = readFileSync(entry.source, 'utf-8');
  writeFileSync(destPath, content);
}

export const testCommand = defineCommand({
  meta: {
    name: 'test',
    description: 'Build opencode and run contract tests',
  },
  async run() {
    // Step 1: Build opencode
    const entries = parseManifest();
    const opencode = entries.find((e) => e.target === 'opencode');
    if (!opencode) {
      console.error('ERROR: opencode target not found in manifest');
      process.exit(1);
    }

    rmrf(`dist/${opencode.distPath}`);
    if (opencode.kind === 'dir') {
      buildDirEntry(opencode);
    } else {
      buildFileEntry(opencode);
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
