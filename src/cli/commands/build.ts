import { defineCommand } from 'citty';
import { parseManifest } from '../lib/manifest';
import { buildManifestEntry, buildTarget } from '../lib/build-target';

export const buildCommand = defineCommand({
  meta: {
    name: 'build',
    description: 'Build agent files for distribution',
  },
  args: {
    target: {
      type: 'string',
      description: 'Target platform to build (builds all if omitted)',
    },
  },
  async run({ args }) {
    const target = args.target as string | undefined;

    if (target) {
      // Clean dist for the target, then rebuild every manifest row.
      if (!buildTarget(target)) {
        console.error(`ERROR: unknown TARGET '${target}'`);
        process.exit(1);
      }
      return;
    }

    // No target: build every manifest row without cleaning.
    for (const entry of parseManifest()) {
      buildManifestEntry(entry);
    }
  },
});
