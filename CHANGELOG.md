# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/dmang-dev/mcp-ppsspp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dmang-dev/mcp-ppsspp/releases/tag/v0.1.0
