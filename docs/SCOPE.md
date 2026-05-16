# mcp-ppsspp — scope and design notes

Fifth in the `dmang-dev/mcp-*` emulator-bridge family. Companion to:

- [mcp-mgba](https://github.com/dmang-dev/mcp-mgba) — GBA via custom Lua bridge over TCP
- [mcp-pine](https://github.com/dmang-dev/mcp-pine) — PCSX2 via PINE binary protocol
- [mcp-retroarch](https://github.com/dmang-dev/mcp-retroarch) — libretro cores via RetroArch NCI (UDP)
- [mcp-bizhawk](https://github.com/dmang-dev/mcp-bizhawk) — multi-system via custom Lua bridge

## Why PPSSPP

PSP is the major retro platform NONE of the other four cover. PPSSPP is the canonical PSP emulator (lead dev Henrik Rydgård), cross-platform, open source.

Critically: **PPSSPP ships its own debugger WebSocket interface**. Unlike mGBA / BizHawk where we had to write a Lua bridge that runs inside the emulator's scripting engine, PPSSPP exposes a rich JSON-RPC API natively. The mcp-ppsspp server is just an MCP-to-WebSocket adapter.

## Architecture

```
Claude / MCP client                mcp-ppsspp (Node.js)             PPSSPP
─────────────────                  ────────────────────              ──────
   MCP stdio   ─────JSON-RPC───>   Adapter / dispatcher  ──WS───>   Debugger
                                                          (JSON)     subscribers
                                                                     ├── MemorySubscriber
                                                                     ├── InputSubscriber
                                                                     ├── SteppingSubscriber
                                                                     ├── BreakpointSubscriber
                                                                     ├── CPUCoreSubscriber
                                                                     ├── GameSubscriber
                                                                     ├── GPUBufferSubscriber
                                                                     ├── HLESubscriber
                                                                     └── ...
```

- **Transport**: WebSocket over TCP. Subprotocol `debugger.ppsspp.org`.
- **Wire format**: JSON request/response with ticket-based correlation. Async broadcasts (game events, log lines) arrive with no ticket and are ignored for now.
- **Default URL**: `ws://127.0.0.1:<PPSSPP_PORT>/debugger`. Port is dynamic per PPSSPP install — exposed in **Settings → Tools → Developer Tools → Allow remote debugger**.

## API surface mapping

Mapping from PPSSPP WebSocket events → MCP tools:

| PPSSPP event | MCP tool |
|---|---|
| `version` | `ppsspp_ping` |
| `game.status` | `ppsspp_get_info` |
| `memory.read_u8` / `_u16` / `_u32` | `ppsspp_read8` / `read16` / `read32` |
| `memory.read` (range, base64) | `ppsspp_read_range` |
| `memory.readString` | `ppsspp_read_string` |
| `memory.write_u8` / `_u16` / `_u32` | `ppsspp_write8` / `write16` / `write32` |
| `memory.write` (range, base64) | `ppsspp_write_range` |
| `input.buttons.send` | `ppsspp_press_buttons` |
| `input.buttons.press` | `ppsspp_press_button` |
| `input.analog.send` | `ppsspp_send_analog` |
| `cpu.stepping` | `ppsspp_pause` |
| `cpu.resume` | `ppsspp_resume` |
| `cpu.stepInto` | `ppsspp_step` |
| `cpu.getAllRegs` | `ppsspp_get_registers` |
| `game.reset` | `ppsspp_reset` |
| `gpu.buffer.screenshot` | `ppsspp_screenshot` (inline PNG return) |
| `cpu.breakpoint.add` / `.remove` / `.list` | `ppsspp_breakpoint_add` / `_remove` / `_list` |

### What we don't (yet) expose

PPSSPP has events for these, but they're not in v0.1.0:

- **GPU**: `gpu.buffer.renderColor` / `renderDepth` / `renderStencil` / `texture` / `clut` — useful for graphics debugging
- **GPU recording**: `gpu.record.dump` — captures a frame's GPU command stream
- **GPU stats**: `gpu.stats.get` / `feed` / `vsync` — performance counters
- **HLE**: `hle.thread.*`, `hle.func.*`, `hle.module.list`, `hle.backtrace` — PSP-OS-level introspection (kernel threads, named module symbols, call stacks)
- **Disasm**: `memory.disasm`, `memory.assemble`, `memory.searchDisasm` — MIPS disassembly + assembly
- **Memory breakpoints**: `memory.breakpoint.*` — read/write/access watchpoints (different from execution breakpoints)
- **Replay**: `replay.*` — input record/replay (PPSSPP's native movie format)
- **Config**: `broadcast.config.*` — get/set arbitrary PPSSPP settings

All trivially addable in follow-ups if there's demand. The v0.1.0 surface targets "drive a game + inspect state + basic debugging" which covers most agent use cases.

### Notable PPSSPP capabilities NOT in other emulator bridges

PPSSPP's debugger is genuinely richer than what BizHawk / mGBA / RetroArch expose:

- **CPU execution breakpoints** with conditions and per-breakpoint enable
- **Memory access breakpoints** (read/write/access — fine-grained)
- **MIPS register state** at any time (gp + fp + special, named)
- **MIPS disassembly** at any address
- **Expression evaluation** (cpu.evaluate)
- **HLE function symbol scanning** for libraries

If we wanted to do real reverse-engineering work on PSP games via Claude, this is a unique-among-the-family surface. The mcp-mgba/mcp-bizhawk Lua bridges don't have native breakpoints; the mcp-pine/mcp-retroarch wrappers can't really debug.

## Reusable from mcp-bizhawk (~80%)

Direct copy with name swaps:
- `package.json` skeleton
- `tsconfig.json`
- `.gitignore`
- `LICENSE`
- `Dockerfile`
- `glama.json`
- `.github/workflows/ci.yml`
- README structure
- CHANGELOG skeleton

Adapt:
- `src/index.ts` — different env vars (`PPSSPP_HOST`, `PPSSPP_PORT`), different "FATAL on missing config" message
- `src/tools.ts` — TDQS-templated descriptions specific to PSP (memory map, MIPS, PSP buttons)

Rewrite:
- **`src/ppsspp.ts`** — WebSocket client (vs `mcp-bizhawk/src/bizhawk.ts`'s TCP server). Different concurrency model (request/response with ticket correlation, not frame-poll), no Lua bridge needed.

## Estimated effort vs actual

| Phase | Estimated | Actual |
|---|---|---|
| Scaffolding | 30 min | 15 min (template copy + package.json swap) |
| WebSocket client | 1 hour | 45 min |
| Tool layer (20 tools, TDQS-templated) | 2 hours | 1.5 hours |
| README / CHANGELOG / SCOPE | 1 hour | 30 min |
| Initial build clean | 30 min | passed first try |
| **Total to GitHub-pushable** | **~5 hours** | **~3 hours** |

Each subsequent server in the mcp-* family gets faster — the template is mature now.

## Risks / unknowns

| Risk | Likelihood | Mitigation |
|---|---|---|
| PPSSPP's WebSocket port discovery is annoying (dynamic per install) | High | Required env var with clear "where to find it" error message |
| `gpu.buffer.screenshot` return format may not be PNG base64 | Medium | Test live before declaring v0.1.0 stable. Adjust if needed. |
| PPSSPP versions older than the v1.x WebSocket may have different event names | Low | Docs say "1.7+"; older versions would fail at event dispatch and we'd see clear errors |
| Mobile PPSSPP (Android/iOS) might not expose the debugger | Medium | Out of scope — desktop-only |
| WebSocket reconnect logic not implemented | Low | First-iteration MVP; if PPSSPP restarts mid-session, current session loses the bridge until restart. Can add retry later. |

## Open questions

1. **Default port**: should we default `PPSSPP_PORT` to a common value (e.g. 12345) instead of requiring it? Risk: the value varies per install, so defaults will work some places and silently misroute elsewhere. Decision: leave required for now, document clearly.
2. **Savestates**: should we hack support via `input.buttons.press` triggering PPSSPP's F1-F8 keybinds? Adds value but is brittle (depends on PPSSPP keybind config). Defer to v0.2.0+ based on user demand.
3. **Broadcasts**: PPSSPP pushes async events (game lifecycle, stepping, log lines). Should we expose these as some kind of MCP subscription/notification? MCP doesn't natively support server-pushed events well. Defer.
