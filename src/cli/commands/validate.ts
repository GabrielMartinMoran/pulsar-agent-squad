import { defineCommand } from 'citty';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/** Frontmatter must open within the first 20 lines of a prompt file. */
function hasFrontmatter(filePath: string): boolean {
  try {
    const first20 = readFileSync(filePath, 'utf-8').split('\n').slice(0, 20).join('\n');
    return first20.includes('---');
  } catch {
    return false;
  }
}

/** Validate every Pi agent source prompt and report each one. */
function validatePiSources(): boolean {
  const piAgentsDir = join('src', 'agents', 'pi');
  console.log('Validating Pi agent sources...');

  if (!existsSync(piAgentsDir)) {
    console.log(`✗ ${piAgentsDir} missing`);
    return false;
  }

  const files = readdirSync(piAgentsDir).filter((file) => file.endsWith('.md'));
  if (files.length === 0) {
    console.log(`✗ ${piAgentsDir} contains no agent prompts`);
    return false;
  }

  let allOk = true;
  for (const file of files) {
    const filePath = join(piAgentsDir, file);
    if (hasFrontmatter(filePath)) {
      console.log(`✓ ${filePath}`);
    } else {
      console.log(`✗ ${filePath} missing frontmatter`);
      allOk = false;
    }
  }
  return allOk;
}

/**
 * Validate Pi artifacts only when the target has been built. A never-built Pi
 * target is not an error; a present but incomplete or malformed build is.
 */
function validateBuiltPiArtifacts(): boolean {
  const piDistRoot = join('dist', 'platforms', 'pi');
  if (!existsSync(piDistRoot)) return true;

  console.log('Validating built artifacts under dist/platforms/pi...');

  const expected = [
    { path: join(piDistRoot, 'agents'), kind: 'dir' as const },
    { path: join(piDistRoot, 'skills'), kind: 'dir' as const },
    { path: join(piDistRoot, 'settings.snippet.json'), kind: 'file' as const },
    { path: join(piDistRoot, 'extensions', 'pas-toolkit'), kind: 'dir' as const },
  ];

  let allOk = true;
  for (const artifact of expected) {
    if (existsSync(artifact.path)) {
      console.log(`✓ ${artifact.path}`);
    } else {
      console.log(`✗ ${artifact.path} missing`);
      allOk = false;
    }
  }

  const distAgentsDir = join(piDistRoot, 'agents');
  const sourceAgentsDir = join('src', 'agents', 'pi');
  if (existsSync(distAgentsDir) && existsSync(sourceAgentsDir)) {
    const sourceAgents = readdirSync(sourceAgentsDir)
      .filter((file) => file.endsWith('.md'))
      .sort();
    const expectedAgents = new Set(sourceAgents);
    const builtAgents = readdirSync(distAgentsDir)
      .filter((file) => file.endsWith('.md'))
      .sort();

    for (const file of builtAgents) {
      if (!expectedAgents.has(file)) {
        console.log(`✗ ${join(distAgentsDir, file)} is not part of the Pi roster`);
        allOk = false;
      }
    }
    for (const file of sourceAgents) {
      const filePath = join(distAgentsDir, file);
      if (!existsSync(filePath)) {
        console.log(`✗ ${filePath} missing`);
        allOk = false;
      } else if (!hasFrontmatter(filePath)) {
        console.log(`✗ ${filePath} missing frontmatter`);
        allOk = false;
      }
    }
  }

  return allOk;
}

export const validateCommand = defineCommand({
  meta: {
    name: 'validate',
    description: 'Validate agent file structure and frontmatter',
  },
  async run() {
    const agents = [
      'Pulsar Agent Squad',
      'Pulsar Agent Turbo',
      'pas_researcher',
      'pas_developer',
      'pas_qa',
    ];

    let allOk = true;

    console.log('Validating centralized agent structure...');

    // Check agent files exist
    for (const agent of agents) {
      const filePath = join('src', 'agents', `${agent}.md`);
      if (existsSync(filePath)) {
        console.log(`✓ ${filePath}`);
      } else {
        console.log(`✗ ${filePath} missing`);
        allOk = false;
      }
    }

    console.log('');

    // Check frontmatter — must have at least one --- line within first 20 lines
    const agentFiles = readdirSync(join('src', 'agents')).filter((f) => f.endsWith('.md'));
    const expectedAgentFiles = new Set(agents.map((agent) => `${agent}.md`));
    for (const file of agentFiles) {
      if (!expectedAgentFiles.has(file)) {
        console.log(`✗ src/agents/${file} is not part of the PAS roster`);
        allOk = false;
      }
    }
    for (const file of agentFiles) {
      const filePath = join('src', 'agents', file);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const first20 = content.split('\n').slice(0, 20).join('\n');
        if (!first20.includes('---')) {
          console.log(`✗ ${filePath} missing frontmatter`);
          allOk = false;
        }
      } catch {
        console.log(`✗ ${filePath} not readable`);
        allOk = false;
      }
    }

    // Also validate built artifacts if they exist
    const distAgentsDir = join('dist', 'platforms', 'opencode', 'agents');
    if (existsSync(distAgentsDir)) {
      console.log('Validating built artifacts under dist/platforms/opencode/agents...');
      const distAgentFiles = readdirSync(distAgentsDir).filter((f) => f.endsWith('.md'));
      for (const file of distAgentFiles) {
        if (!expectedAgentFiles.has(file)) {
          console.log(`✗ ${distAgentsDir}/${file} is not part of the PAS roster`);
          allOk = false;
        }
      }
      for (const agent of agents) {
        const filePath = join(distAgentsDir, `${agent}.md`);
        if (existsSync(filePath)) {
          console.log(`✓ ${filePath}`);
        } else {
          console.log(`✗ ${filePath} missing`);
          allOk = false;
        }
      }
    }

    console.log('');
    if (!validatePiSources()) allOk = false;
    if (!validateBuiltPiArtifacts()) allOk = false;

    if (allOk) {
      console.log('✓ Agent files have valid centralized structure');
      console.log('');
      console.log('Validation complete!');
    } else {
      console.log('');
      console.log('Validation complete!');
      process.exit(1);
    }
  },
});
