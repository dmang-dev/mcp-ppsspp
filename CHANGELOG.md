# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`ppsspp_set_register`** — write a single MIPS Allegrex register (GPR, PC,
  HI/LO, or FPU) via PPSSPP's `cpu.setReg`. The write counterpart to
  `ppsspp_get_registers`: redirect execution (`pc`), patch a return value
  (`v0`) or argument (`a0`-`a3`), etc. `value` accepts a JSON integer or a
  string for hex/float/special (`'0x1F'`, `'1.5'`, `'nan'`) forms. Closes the
  register-write half of the completeness gap flagged on the Glama profile.

### Note

- Savestate save/load (the other half of the flagged gap) remains
  **out of scope**: PPSSPP's WebSocket debugger exposes no savestate API
  (no `savestate.*` event group), so there is nothing to wrap. Use PPSSPP's
  F1-F8 save-slot keybinds.

## [0.1.4] - 2026-05-16

Closes the auto-reconnect gap that v0.1.2 and v0.1.3 missed: the
WebSocket close handler cleared `ws` and `ready` but **not** the
memoized `readyPromise`. After PPSSPP was closed mid-session
(taskkill, crash, user-quit), the next call would short-circuit on
the stale resolved promise and crash on `this.ws!.send(...)` —
the very "Cannot read properties of null (reading 'send')" error
that v0.1.2's `ensureConnected()` was supposed to make impossible.

In practice: v0.1.2/0.1.3 auto-reconnect worked for the *initial*
connection, but if PPSSPP was up at MCP startup and later closed,
the MCP server got wedged until restart. Surfaced live during an
E2E test of v0.1.3.

### Fixed

- **`readyPromise` cleared in WebSocket close handler** — one-line
  fix in `src/ppsspp.ts`. Now `start()` actually attempts a fresh
  connect on the next call instead of returning a cached resolved
  promise that points at a dead socket.

### Added

- **`scripts/verify-reconnect.cjs`** + `npm run verify:reconnect`
  — regression test that exercises the bug specifically:
  connects → pings → calls `ws.close()` to fire the close handler →
  pings again. PASS if the second ping doesn't throw the null-deref
  (i.e., `start()` didn't short-circuit on the stale promise).

[0.1.4]: https://github.com/dmang-dev/mcp-ppsspp/releases/tag/v0.1.4

## [0.1.3] - 2026-05-16

Screenshot default switched to the safer GPU readback path after a
real PPSSPP crash on a homebrew. Root cause is upstream
(`_assert_(buf != nullptr)` in `GPUBufferSubscriber.cpp` that
should be a graceful `req.Fail`); we can't catch a process abort
from outside, but we can stop steering callers into the
crash-prone code path by default.

### Changed

- **`ppsspp_screenshot` now defaults to `gpu.buffer.renderColor`**
  (reads the active GPU render target via
  `GPU_GetCurrentFramebuffer(GPU_DBG_FRAMEBUF_RENDER)`) instead of
  `gpu.buffer.screenshot` (which reads PPSSPP's final composited
  output via the crash-prone `GPU_GetOutputFramebuffer`). The
  render target is the actual rendered scene at PSP-native
  480×272, before PPSSPP's post-processing (scaling, shaders).
  For agent-vision use cases this is identical content; for
  matching what's on your monitor you'd want the post-processed
  output.
- **New `source` parameter on `ppsspp_screenshot`** (enum
  `'render' | 'output'`, default `'render'`) lets callers opt
  into the post-processed `gpu.buffer.screenshot` path when they
  specifically need it. The tool description carries a clear
  warning that `'output'` can crash PPSSPP on certain games.
  If PPSSPP does crash, v0.1.2's auto-reconnect ensures MCP
  recovers cleanly when PPSSPP is relaunched.

### Known limitations

- **`source: 'output'` can still crash PPSSPP** — this is an
  upstream bug. Once the assertion in `GPUBufferSubscriber.cpp`
  is converted to a `req.Fail` upstream, both sources will fail
  gracefully. Tracking upstream.

[0.1.3]: https://github.com/dmang-dev/mcp-ppsspp/releases/tag/v0.1.3

## [0.1.2] - 2026-05-16

Auto-reconnect now covers fire-and-forget commands too. Previously
`call()` would lazy-reconnect if PPSSPP had been closed and reopened,
but `fireAndForget()` (used by pause/resume/screenshot) still threw the
old "PPSSPP not connected — did you start() the client?" error,
leaving those tools broken across PPSSPP restarts until the MCP client
itself restarted.

### Fixed

- **`fireAndForget()` now auto-reconnects** — extracted the lazy
  connection guard from `call()` into a shared `ensureConnected()`
  helper, then routed `fireAndForget()` through it too. `ppsspp_pause`,
  `ppsspp_resume`, and `ppsspp_screenshot` (which internally uses
  fire-and-forget for the pause/capture/resume bracket) now survive a
  PPSSPP close-and-relaunch without needing the MCP server itself to
  restart. Same memoized-`readyPromise` safety as before: concurrent
  callers share a single underlying connect attempt.

### Changed

- **`fireAndForget()` is now `async`** (returns `Promise<void>`
  instead of `void`). All in-tree callers in `src/tools.ts` and
  `scripts/smoke.cjs` updated to `await` it. External callers (if
  any) must add `await` — but this package's `PpssppClient` is not
  documented as a public API, so no real consumers should be affected.

[0.1.2]: https://github.com/dmang-dev/mcp-ppsspp/releases/tag/v0.1.2

## [0.1.1] - 2026-05-16

Three real bugs surfaced by the first live test against PPSSPP v1.20.3 +
a homebrew PSP game. Protocol mapping was right in the abstract but
wrong in the details — fixing.

### Fixed

- **Memory reads were returning `undefined`** — PPSSPP's
  `memory.read_u8` / `_u16` / `_u32` responses use the field name
  `value`, not `uintValue` (which I'd assumed from the singular-register
  `cpu.getReg`/`setReg` responses, which DO use `uintValue`). Smoke
  test now confirms `read32` + write `0xDEADBEEF` + read-back round-trip.
- **`cpu.getAllRegs` response shape was wrong** — I'd assumed
  `{categories: [{name, registers: [{name, uintValue}]}]}`. Actual
  PPSSPP shape is `{categories: [{name, registerNames: [...],
  uintValues: [...], floatValues: [...]}]}` — **parallel arrays**, not
  an array of objects. Rewrote the handler to walk parallel arrays
  with bounds-aware indexing.
- **`cpu.stepping` and `cpu.resume` were hanging** — PPSSPP source
  documents these as "No immediate response. Once CPU is stepping, a
  'cpu.stepping' event will be sent" (async broadcast with no ticket).
  My ticketed `call()` was waiting 10s for a reply that never comes.
  Added `PpssppClient.fireAndForget(event, params)` and
  `PpssppClient.waitForState(predicate, opts)` which polls
  `cpu.status` (which IS synchronous) until the state change is
  detected. `ppsspp_pause` / `ppsspp_resume` / the screenshot
  internal pause/resume now use this pattern.

### Changed

- **`ppsspp_screenshot` now auto-pauses + auto-resumes** — PPSSPP's
  `gpu.buffer.screenshot` requires CPU or GPU to be stepping
  (otherwise "Neither CPU or GPU is stepping" error). The tool now
  transparently `cpu.stepping`s, captures, and `cpu.resume`s. If the
  caller had already paused, it leaves the state alone on exit.
  Also requests `type: "base64"` explicitly (default is `"uri"` which
  returns a `data:image/png;base64,...` prefix); belt-and-suspenders
  URI-prefix stripping kept as a fallback.

### Known limitations

- **`gpu.buffer.screenshot` is backend-dependent** — observed
  "Could not download output" on a homebrew where the GPU readback
  path can't fetch the framebuffer. This is a PPSSPP-side limitation,
  not a bug in our code. Likely works on commercial PSP games with
  normal rendering.

[0.1.1]: https://github.com/dmang-dev/mcp-ppsspp/releases/tag/v0.1.1

## [0.1.0] - 2026-05-16

Initial public release.

### Added

- **Node.js MCP server** that connects to PPSSPP's built-in WebSocket
  debugger interface (no Lua bridge needed — PPSSPP ships its own
  debugger). Subprotocol `debugger.ppsspp.org` on PPSSPP's dynamic
  debugger port.
- **20 MCP tools** spanning memory r/w (u8/u16/u32/range/string),
  input (buttons.send, buttons.press, analog.send), emulator control
  (pause, resume, step, reset, screenshot), CPU debugger
  (get_registers), and CPU execution breakpoints (add/remove/list).
- **Inline screenshot returns** — `ppsspp_screenshot` returns the PSP
  framebuffer as a base64 PNG content block, viewable directly in the
  MCP client (Claude, etc.) without separate read calls.
- **TDQS-templated tool descriptions** — every tool follows the
  PURPOSE / USAGE / BEHAVIOR / RETURNS structure with explicit
  PSP-specific context (memory map, button names, MIPS-LE).
- **Cross-platform install paths**: `npm install -g mcp-ppsspp`,
  `npx -y mcp-ppsspp`, or clone-and-build.
- **GitHub Actions CI** building on Node 18/20/22 across
  Linux/macOS/Windows.
- **Dockerfile + glama.json** for the [Glama MCP registry](https://glama.ai/mcp/servers).

### Known limitations

- **No savestate API exposed by PPSSPP's WebSocket** — savestate
  save/load isn't in the debugger interface. Use PPSSPP's keybinds
  (F1-F8 for slots) via the UI.
- **Frame-advance is instruction-level only** (`cpu.stepInto` steps
  one MIPS instruction, not one rendered frame). For frame stepping,
  set a breakpoint at the vblank handler and resume.

[Unreleased]: https://github.com/dmang-dev/mcp-ppsspp/compare/v0.1.4...HEAD
[0.1.0]: https://github.com/dmang-dev/mcp-ppsspp/releases/tag/v0.1.0
