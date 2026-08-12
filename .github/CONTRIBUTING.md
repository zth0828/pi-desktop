# Contributing to Pi Desktop

Thank you for helping improve Pi Desktop. Bug reports, focused feature
proposals, documentation fixes, and pull requests are welcome.

## Before you start

- Search existing issues before opening a new one.
- Keep agent capabilities in pi or a pi extension. Pi Desktop owns the desktop
  experience and integration layer, not a separate agent runtime.
- Do not include API keys, credentials, private sessions, proprietary source
  code, or other sensitive data in issues, logs, screenshots, or fixtures.
- For a substantial feature or architecture change, open an issue first so the
  scope can be discussed before implementation.

## Development setup

Requirements and source setup are documented in the
[README](https://github.com/zth0828/pi-desktop#run-from-source).

Before submitting a pull request, run:

```bash
pnpm typecheck
pnpm test
pnpm test:contract
pnpm test:e2e
pnpm build:vite
```

Contract and Electron tests use local mock providers and isolated pi data. They
must not consume a real model quota or access personal sessions.

## Pull requests

- Keep each pull request focused on one coherent change.
- Explain the user-facing problem and the chosen behavior.
- Add tests proportional to risk. Renderer UI changes require Electron
  Playwright coverage.
- Add every user-visible string to both English and Chinese locale files.
- Preserve the typed `hostInvoke` boundary between the renderer and Electron
  main process.
- Attribute code adapted from another project in source comments, NOTICE, and
  the commit body as required by its license.

## Licensing contributions

By submitting a contribution, you confirm that you have the right to provide
it and agree that it is distributed under the project's
[license](https://github.com/zth0828/pi-desktop/blob/main/LICENSE).
