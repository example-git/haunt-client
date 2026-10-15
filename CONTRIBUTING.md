# Contributing

This repository owns the browser client, Electron desktop application, and shared
TypeScript client libraries. Server contracts are generated inputs; change their
source in Haunt Server before updating the checked-in snapshots here.

## Before submitting a change

- Keep saved sessions, signing keys, private plugins, model downloads, and local
  configuration out of Git.
- Add tests for behavior changes and update user-facing documentation.
- Keep generated brand assets, emoji data, API snapshots, and lockfiles in sync
  with their documented generators.
- Do not manually edit versions normally managed by the `main` version workflow.

Run:

```sh
npm ci
npm test
npm run build
python3 scripts/check-repository.py
python3 scripts/check-docs.py
```

Packaging or update changes also require the platform-specific checks documented
in [docs/releases.md](docs/releases.md). Report vulnerabilities through the
private process in [SECURITY.md](SECURITY.md), not in a public issue.

