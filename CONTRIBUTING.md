# Contributing to OpenAgentPay

Thank you for your interest in contributing to OpenAgentPay! This guide will help you get started.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies: `pnpm install`
4. Create a feature branch: `git checkout -b feat/my-feature`

## Development

This project uses:

- **pnpm** for package management
- **Turborepo** for monorepo orchestration
- **Biome** for linting and formatting
- **TypeScript** with strict mode

### Common Commands

```bash
pnpm build        # Build all packages
pnpm test         # Run all tests
pnpm lint         # Lint all packages
pnpm typecheck    # Type-check all packages
pnpm format       # Format code with Biome
```

## Pull Requests

1. Ensure your code passes all checks: `pnpm lint && pnpm typecheck && pnpm test`
2. Write clear, descriptive commit messages
3. Keep PRs focused on a single change
4. Add tests for new functionality
5. Update documentation as needed

## Commit Messages

Use conventional commit format:

- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation changes
- `test:` adding or updating tests
- `refactor:` code refactoring
- `chore:` maintenance tasks

## Reporting Issues

- Use GitHub Issues to report bugs or request features
- Include reproduction steps for bugs
- Search existing issues before creating new ones

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
