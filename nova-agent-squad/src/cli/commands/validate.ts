import { defineCommand } from 'citty';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export const validateCommand = defineCommand({
  meta: {
    name: 'validate',
    description: 'Validate agent file structure and frontmatter',
  },
  async run() {
    const agents = [
      'Nova Agent Squad',
      'nas_researcher',
      'nas_planner',
      'nas_developer',
      'nas_qa',
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
