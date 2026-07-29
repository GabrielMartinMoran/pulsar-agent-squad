# Contributing to Nova Agent Squad

Thank you for your interest in contributing to Nova Agent Squad!

## Code of Conduct

Be respectful, collaborative, and focused on reducing hallucinations in AI-assisted development.

## How to Contribute

### Reporting Issues

1. Check if the issue already exists
2. If not, create a detailed issue with:
   - Clear description
   - Steps to reproduce (if applicable)
   - Expected vs actual behavior
   - Environment details (OpenCode version, OS, model used)

### Suggesting Features

1. Open a discussion first to gauge interest
2. Provide a clear use case
3. Explain how it aligns with NAS's anti-hallucination goals

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Update CHANGELOG.md following the format
5. Submit a pull request

## Agent Modification Guidelines

When modifying agent prompts:

1. **Test locally first** - Copy agents to your OpenCode config and verify behavior
2. **Maintain anti-hallucination guards** - Never remove authorization gates
3. **Keep XML contracts** - Preserve the structured output tags
4. **Document changes** - Update CHANGELOG.md with clear descriptions
5. **Version appropriately** - Follow the versioning scheme in AGENTS.md

## Development Setup

```bash
# Clone your fork
git clone git@github.com:YOUR_USERNAME/neocortex-strike-team.git
cd neocortex-strike-team

# Install locally to test
make install

# Validate agent structure
make validate
```

## Commit Messages

Use clear, descriptive commit messages:

- `feat: add skill discovery for project-level skills`
- `fix: prevent developer from editing without authorization`
- `docs: update architecture diagram`
- `chore: bump version to v1.1.0`

## Questions?

Open an issue for questions about contributing.
