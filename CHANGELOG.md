# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/dmang-dev/mcp-ppsspp/compare/v0.1.1...HEAD
[0.1.0]: https://github.com/dmang-dev/mcp-ppsspp/releases/tag/v0.1.0
