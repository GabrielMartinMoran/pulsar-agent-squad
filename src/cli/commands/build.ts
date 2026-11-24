import { defineCommand } from 'citty';
import { parseManifest } from '../lib/manifest';
import {
  buildManifestEntries,
  selectManifestEntries,
} from '../lib/build-target';

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
    const entries = selectManifestEntries(parseManifest(), target);

    if (entries.length === 0) {
      console.error(`ERROR: unknown TARGET '${target}'`);
      process.exit(1);
    }

    buildManifestEntries(entries);
  },
});
