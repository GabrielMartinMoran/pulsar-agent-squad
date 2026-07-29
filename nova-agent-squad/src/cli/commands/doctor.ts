import { defineCommand } from 'citty';
import { parseManifest } from '../lib/manifest';
import { spawnSync } from 'bun';
import { existsSync, readFileSync } from 'fs';

let FAILURES = 0;

function pass(msg: string): void {
  console.log(`PASS: ${msg}`);
}

function fail(msg: string): void {
  console.log(`FAIL: ${msg}`);
  FAILURES++;
}

function checkCommand(cmd: string): void {
  const result = spawnSync(['which', cmd], { stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode === 0) {
    pass(`commands/${cmd} available`);
  } else {
    fail(`commands/${cmd} missing`);
  }
}

function checkReadableDir(path: string): void {
  if (existsSync(path)) {
    try {
      const stat = require('fs').statSync(path);
      if (stat.isDirectory()) {
        pass(`structure/${path} directory readable`);
        return;
      }
    } catch {
      // fall through
    }
  }
  fail(`structure/${path} missing or not readable`);
}

function checkReadableFile(path: string): void {
  if (existsSync(path)) {
    try {
      require('fs').accessSync(path, require('fs').constants.R_OK);
      pass(`structure/${path} file readable`);
      return;
    } catch {
      // fall through
    }
  }
  fail(`structure/${path} missing or not readable`);
}

export const doctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Check agent system preconditions',
  },
  async run() {
    console.log('== doctor: command preconditions ==');
    for (const cmd of ['bash', 'cp', 'mkdir', 'rm', 'opencode']) {
      checkCommand(cmd);
    }

    console.log('');
    console.log('== doctor: centralized structure ==');
    const MANIFEST = 'config/platforms.manifest';
    checkReadableFile(MANIFEST);
    checkReadableDir('src');
    checkReadableDir('src/templates');

    console.log('');
    console.log('== doctor: manifest targets and source routes ==');
    if (existsSync(MANIFEST)) {
      try {
        readFileSync(MANIFEST, 'utf-8'); // verify readable
        const entries = parseManifest();

        if (entries.length === 0) {
          fail('manifest has no target entries');
        }

        for (const entry of entries) {
          const prefix = `manifest/${entry.target}`;

          if (entry.kind === 'dir') {
            if (existsSync(entry.source)) {
              try {
                const stat = require('fs').statSync(entry.source);
                if (stat.isDirectory()) {
                  pass(`${prefix} source dir readable: ${entry.source}`);
                } else {
                  fail(`${prefix} source dir missing/unreadable: ${entry.source}`);
                }
              } catch {
                fail(`${prefix} source dir missing/unreadable: ${entry.source}`);
              }
            } else {
              fail(`${prefix} source dir missing/unreadable: ${entry.source}`);
            }
          } else if (entry.kind === 'file') {
            if (existsSync(entry.source)) {
              pass(`${prefix} source file readable: ${entry.source}`);
            } else {
              fail(`${prefix} source file missing/unreadable: ${entry.source}`);
            }
          } else {
            fail(`${prefix} invalid kind: ${entry.kind}`);
          }

          pass(`${prefix} dist_path present: ${entry.distPath}`);
          pass(`${prefix} install_path present: ${entry.installPath}`);
        }
      } catch {
        fail(`manifest file not readable: ${MANIFEST}`);
      }
    }

    console.log('');
    if (FAILURES > 0) {
      console.log(`FAIL: doctor found ${FAILURES} critical issue(s)`);
      process.exit(1);
    }
    console.log('PASS: doctor checks completed');
  },
});
