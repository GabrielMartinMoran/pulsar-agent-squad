# NAS Installation Matrix (Approved Scope)

This matrix defines the currently supported installation/distribution targets for Nova Agent Squad (NAS).

## Support status

- **GA**: expected to work with documented path in this repository.
- **Beta**: template provided; requires user adaptation/validation in target runtime.
- **Experimental**: bootstrap only; behavior depends on external tooling maturity.
- **Temporarily not viable**: intentionally not supported yet due to missing verifiable technical docs.

| Platform | Status | Installation artifact/template | Limitations |
|---|---|---|---|
| OpenCode | GA | `src/agents/*` -> `dist/platforms/opencode/agents/*` -> `nas install --target=opencode` | Canonical runtime; fully validated install flow and baseline parity target. |
| Cursor | Beta | `src/templates/platforms/cursor/AGENTS.md.tmpl` -> `dist/platforms/cursor/AGENTS.md` | Generated template; adapt to workspace conventions before production use. |
| Cursor CLI Agent | Beta | `dist/platforms/cursor-cli-agent/AGENTS.md` | Supported through `rules` + `AGENTS` conventions; exact invocation UX may vary by version. |
| Claude Code | Experimental | `dist/platforms/claude-code/CLAUDE.md` | Template is bootstrap-oriented; confirm actual command/runtime hooks in your environment. |
| Codex | Experimental | `src/templates/platforms/codex/AGENTS.md.tmpl` -> `dist/platforms/codex/AGENTS.md` | Runtime capabilities and tool routing may vary by runner version. |
| Gemini CLI | Experimental | `src/templates/platforms/gemini-cli/AGENTS.md.tmpl` -> `dist/platforms/gemini-cli/AGENTS.md` | Requires experimental flag `experimental.enableAgents=true`; validate locally before production use. |
| Kiro IDE | Experimental | `src/templates/platforms/kiro/AGENTS.md.tmpl` -> `dist/platforms/kiro/AGENTS.md` | Final wiring depends on IDE runtime version. |
| Kiro CLI | Experimental | `src/templates/platforms/kiro/AGENTS.md.tmpl` -> `dist/platforms/kiro/AGENTS.md` | Subagents supported, but runtime subagent tool access can be limited versus primary runtime. |
| VS Code | Experimental | `dist/platforms/vscode/.vscode/nas.instructions.md` | Depends on extension/toolchain used inside VS Code; no single native NAS installer. |
| Antigravity | Temporarily not viable | N/A | **Temporarily not viable: no verifiable technical documentation** for an NAS-compatible agent installation/execution contract. |

## Notes

1. OpenCode remains the reference implementation and should not regress.
2. Non-OpenCode targets are generated from centralized templates to keep scope limited to packaging/installation guidance.
3. Legacy per-platform source directories were removed to avoid double source.
4. Marketplace publication is out of scope for this change.
