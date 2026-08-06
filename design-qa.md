# Design QA — Pi Desktop macOS 顶部与大量会话交互

- source visual truth path: `/var/folders/_z/2_1zd2vn1d57r0hkzq8zr4l40000gn/T/codex-clipboard-b65cea21-8244-454e-9f14-fd4777c184a0.png`
- implementation screenshot path: `/tmp/pi-desktop-session-context-menu-v2.png`
- large-session screenshot path: `/tmp/pi-desktop-many-sessions-v2.png`
- combined comparison path: `/tmp/pi-desktop-window-session-comparison-v2.png`
- viewport: Electron renderer `1200 × 800` CSS px
- source pixels: `830 × 792`
- implementation pixels: `2400 × 1600` at device scale factor 2 (`1200 × 800` CSS px)
- focused implementation crop: `1050 × 1100` source pixels, normalized to `756 × 792` for side-by-side comparison
- state: light theme, active project expanded, session right-click menu open; separate large-session state with 25 sessions and “Show more” visible

## Full-view comparison evidence

The implementation keeps the requested hierarchy visible in one frame: project/session navigation remains in the left sidebar, the standalone chat header is absent, and the workspace/model/context controls remain in the composer. The macOS title area now reserves a 54 px drag/control region and starts “New chat” below it, so the traffic lights and primary action no longer share one visual row.

## Focused-region comparison evidence

The side-by-side comparison demonstrates the requested correction: the source shows the traffic lights touching the new-chat card, while the implementation leaves a clear dedicated top band. The session menu is rendered as a viewport-level floating panel, supports both right-click and the three-dot trigger, and uses automatic edge avoidance instead of being clipped by the scrolling sidebar. The 25-session capture confirms a compact ten-item initial batch, remaining-count affordance, and fixed bottom navigation.

## Required fidelity surfaces

- Fonts and typography: system UI typography is consistent with the existing application; menu labels remain legible at the sidebar's compact density with no wrapping.
- Spacing and layout rhythm: the top control band and new-chat button are visually separated; row padding, menu spacing, and “Show more” maintain a compact sidebar rhythm without pushing away bottom navigation.
- Colors and visual tokens: existing background, border, hover, text, and danger tokens are reused; light-theme contrast is clear.
- Image quality and asset fidelity: no raster assets are required; standard interface icons come from the project's icon library and render sharply.
- Copy and content: zh/en parity is present for every new action and the remaining-session count. Labels describe the actual pi-backed behavior rather than unsupported shell-only features.

## Findings

- No actionable P0/P1/P2 mismatch remains for the requested iteration.
- Accepted product constraint: reference-only actions such as pin, unread, deep-link copy, Finder reveal, and new-window/worktree continuation remain omitted because this shell must not invent capabilities outside pi's current SDK/CLI contract.

## Comparison history

- Earlier state: the new-chat button visually occupied the traffic-light row; session menus lived inside the scroll container and could be clipped; each project silently truncated after ten sessions.
- Fixes made: enlarged the macOS-only drag/control band, moved menus into a body portal with viewport clamping, added right-click handling, and introduced ten-at-a-time expansion plus independent sidebar scrolling.
- Post-fix evidence: `/tmp/pi-desktop-window-session-comparison-v2.png` and `/tmp/pi-desktop-many-sessions-v2.png`; Electron E2E verifies top spacing, bottom-edge menu positioning, rename persistence, 25-session expansion, and scrolling.

## Implementation checklist

- [x] Native pi session ID is available to the renderer through typed host data.
- [x] Copy ID uses Electron clipboard through the single host-invoke channel.
- [x] Rename and continue-in-new-chat use pi SessionManager/runtime APIs.
- [x] Archive state is stored as a pi custom session entry.
- [x] Delete is confirmed and uses the system trash in the real application.
- [x] macOS hidden-inset layout has a tested draggable region in both onboarding and the ready application shell.
- [x] macOS traffic lights and the new-chat action occupy separate vertical regions.
- [x] Right-click and three-dot triggers open the same viewport-safe session menu.
- [x] Rename persistence is verified in both the sidebar and Sessions page.
- [x] Projects with more than ten sessions can progressively reveal all sessions while the sidebar scrolls independently.
- [x] zh/en translations and Electron E2E coverage are complete.

## Follow-up polish

- P3: add a transient “ID copied” acknowledgement if broader toast infrastructure is introduced later.

final result: passed
