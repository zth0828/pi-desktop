> [!WARNING]
> Verify the published SHA-256 checksum before opening a preview package.
> macOS builds without Apple release credentials use an ad-hoc integrity
> signature rather than Developer ID notarization. If Gatekeeper blocks direct
> launch, open `Installation instructions.txt` in the DMG and run the bundled
> installer through Terminal. Windows SmartScreen may also show a warning.

Pi Desktop requires a compatible global pi installation:

```bash
npm i -g @earendil-works/pi-coding-agent
```

This software is free for personal and non-commercial use. Commercial use
requires prior written authorization; see the included LICENSE.
