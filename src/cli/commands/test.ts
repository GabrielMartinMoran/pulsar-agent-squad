import { defineCommand } from 'citty';
import { readdirSync } from 'fs';
import { spawnSync } from 'bun';
import { join } from 'path';
import { buildTarget } from '../lib/build-target';

export const testCommand = defineCommand({
  meta: {
    name: 'test',
    description: 'Build opencode and run contract tests',
  },
  async run() {
    // Step 1: Build the opencode target through the shared builder so `pas
    // test` and `pas build` walk sources identically (including nested
    // directories that used to crash the duplicate walker with EISDIR).
    if (!buildTarget('opencode')) {
      console.error('ERROR: opencode target not found in manifest');
      process.exit(1);
    }

    // Step 2: Run all contract test scripts
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
