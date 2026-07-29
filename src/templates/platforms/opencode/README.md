## OpenCode template note

OpenCode does **not** use a file-based template in `src/templates/platforms/opencode`.

Reason:
- In `config/platforms.manifest`, OpenCode is declared as `kind=dir`.
- Its source of truth is the shared agent directory: `src/agents`.
- Build output is generated to `dist/platforms/opencode/agents` from `src/agents`.

This directory exists only as a consistency marker/documentation point for the platform layout.
