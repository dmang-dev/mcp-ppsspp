# mcp-ppsspp

[![npm version](https://img.shields.io/npm/v/mcp-ppsspp.svg)](https://www.npmjs.com/package/mcp-ppsspp)
[![npm downloads](https://img.shields.io/npm/dm/mcp-ppsspp.svg)](https://www.npmjs.com/package/mcp-ppsspp)
[![CI](https://github.com/dmang-dev/mcp-ppsspp/actions/workflows/ci.yml/badge.svg)](https://github.com/dmang-dev/mcp-ppsspp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/npm/l/mcp-ppsspp.svg)](LICENSE)
[![Snyk](https://snyk.io/test/npm/mcp-ppsspp/badge.svg)](https://snyk.io/test/npm/mcp-ppsspp)
[![Socket](https://img.shields.io/badge/Socket-security-2F7BFF?logo=socket)](https://socket.dev/npm/package/mcp-ppsspp)
[![Bundlephobia](https://img.shields.io/badge/bundlephobia-size-FF6B81)](https://bundlephobia.com/package/mcp-ppsspp)
[![npmgraph](https://img.shields.io/badge/npmgraph-dependencies-2496ED)](https://npmgraph.js.org/?q=mcp-ppsspp)

An [MCP](https://modelcontextprotocol.io) server that exposes [PPSSPP](https://www.ppsspp.org) — the PlayStation Portable emulator — to any MCP-compatible client (Claude Desktop, Claude Code, etc.) via PPSSPP's built-in WebSocket debugger interface.

Read and write PSP memory, drive games with button input, capture screenshots, set CPU breakpoints, inspect MIPS Allegrex registers — all through a clean tool interface. No bridge plugin needed; PPSSPP's debugger is built into the emulator.

## How it works

```
+------------------+    stdio     +------------------+   WebSocket    +------------------+
|   MCP client     |   JSON-RPC   |    mcp-ppsspp    |   JSON-RPC     |     PPSSPP       |
| (Claude / etc.)  | ===========> |     (Node.js)    | =============> |    (debugger)    |
+------------------+              +------------------+                +------------------+
```

Unlike the [mcp-bizhawk](https://github.com/dmang-dev/mcp-bizhawk) / [mcp-mgba](https://github.com/dmang-dev/mcp-mgba) bridges (which need a Lua plugin loaded into the emulator), PPSSPP ships with its own debugger WebSocket interface — we just speak JSON to it. **No plugin to install.**

The connection uses subprotocol `debugger.ppsspp.org` on PPSSPP's debugger port.

## Requirements

- [PPSSPP](https://www.ppsspp.org/download) (recent version with WebSocket debugger — 1.7+)
- **Node.js 22+**
- "Allow remote debugger" enabled in PPSSPP

## Install

```bash
npm install -g mcp-ppsspp
```

Or `npx -y mcp-ppsspp`.

## Set up PPSSPP's debugger

1. Launch PPSSPP, load any PSP ISO/EBOOT
2. **Settings → Tools → Developer Tools → Allow remote debugger** (check the box)
3. PPSSPP will show the active host:port (e.g. `ws://192.168.1.10:12345/debugger`)
4. Note the port number — you'll set it as an environment variable for the MCP server

## Register with your MCP client

### Claude Code (CLI)

```bash
claude mcp add ppsspp --scope user --env PPSSPP_PORT=12345 mcp-ppsspp
```

Replace `12345` with your actual port. Verify:

```bash
claude mcp list
# ppsspp: mcp-ppsspp - ✓ Connected
```

### Claude Desktop

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ppsspp": {
      "command": "mcp-ppsspp",
      "env": { "PPSSPP_PORT": "12345" }
    }
  }
}
```

Restart Claude Desktop after editing.

## Configuration

| Env var        | Default       | Purpose                                          |
|----------------|---------------|--------------------------------------------------|
| `PPSSPP_HOST`  | `127.0.0.1`   | WebSocket host to dial                           |
| `PPSSPP_PORT`  | (required)    | WebSocket port — see PPSSPP's debugger settings  |

## Tools

| Tool | Description |
|------|-------------|
| `ppsspp_ping` | Verify connectivity (returns version) |
| `ppsspp_get_info` | Title, disc ID, version, run state |
| `ppsspp_read8` / `ppsspp_read16` / `ppsspp_read32` | Read u8 / u16-LE / u32-LE from PSP memory |
| `ppsspp_write8` / `ppsspp_write16` / `ppsspp_write32` | Write to PSP memory |
| `ppsspp_read_range` | Read up to 64 KiB as a byte array |
| `ppsspp_write_range` | Write byte array to memory |
| `ppsspp_read_string` | Read null-terminated UTF-8 string |
| `ppsspp_press_buttons` | Set persistent PSP button state |
| `ppsspp_press_button` | Press a button for N frames + auto-release |
| `ppsspp_send_analog` | Set analog stick position |
| `ppsspp_pause` / `ppsspp_resume` | Pause / resume emulation |
| `ppsspp_step` | Step one MIPS instruction |
| `ppsspp_reset` | Soft-reset the loaded game |
| `ppsspp_screenshot` | Capture framebuffer as inline PNG |
| `ppsspp_get_registers` | Read all MIPS Allegrex registers |
| `ppsspp_breakpoint_add` / `_remove` / `_list` | CPU execution breakpoints |

### PSP memory map (cheat sheet)

| Range                    | Region                          |
|--------------------------|---------------------------------|
| `0x00010000` - `0x00013FFF` | Scratchpad (fast 16 KiB SRAM)   |
| `0x04000000` - `0x041FFFFF` | VRAM (2 MiB GE video memory)    |
| `0x08000000` - `0x087FFFFF` | Kernel RAM (8 MiB, low half)    |
| `0x08800000` - `0x09FFFFFF` | User RAM (24 MiB, where most game state lives) |
| `0xBC000000+`              | Hardware registers              |

PSP is **little-endian** (MIPS Allegrex). Kernel-mode mirrors at `0x88xxxxxx` map to the same physical RAM as `0x08xxxxxx`.

### PSP buttons

`cross`, `circle`, `triangle`, `square`, `up`, `down`, `left`, `right`, `start`, `select`, `ltrigger`, `rtrigger`, `home`.

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `PPSSPP_PORT must be set` on startup | Set the env var to the port shown in PPSSPP's Developer Tools dialog |
| `WebSocket connection failed` | PPSSPP isn't running, "Allow remote debugger" isn't checked, or you have the wrong port |
| Tool calls hang / time out | Check the PPSSPP UI is responding; the WebSocket request requires PPSSPP's main loop to dispatch |
| `Invalid address` on memory ops | Address is outside the PSP's mapped regions (user RAM is `0x08800000+`, not `0x00000000+`) |
| Screenshot returns no data | No game loaded — boot an ISO/EBOOT first |
| Buttons don't seem to do anything | PPSSPP's input has the buttons but they may not "feel" right via remote input if the game polls fast; try `ppsspp_press_button` with a longer `duration` |

## Limitations

- **No savestate API** — PPSSPP's WebSocket debugger doesn't expose `savestate.save` / `load`. Use PPSSPP's keybinds (F1-F8 for slots) via the UI for now. Could be hacked by using `input.buttons.press` to trigger the keybind, but not native.
- **Frame-advance is instruction-level only** (`cpu.stepInto`). To advance a whole frame, set a breakpoint at the vblank handler and `resume`.
- **Analog stick is shared state** — `ppsspp_send_analog` updates the persistent stick position; not auto-released.

## Development

```bash
npm install
npm run dev      # tsc --watch — autobuilds on src/ changes
```

## Debugging with the MCP Inspector

Browse and call this server's tools interactively with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
PPSSPP_PORT=<port> npm run inspector
```

Build first if you've edited `src/` since your last `npm install` (`npm run build`, or keep `npm run dev` running). `mcp-ppsspp` has no default port — read the active one off PPSSPP's **Developer Tools → Allow remote debugger** dialog and pass it as `PPSSPP_PORT`. `tools/list` works even without PPSSPP connected; *calling* a tool needs PPSSPP running with the remote debugger enabled.

## License

[MIT](LICENSE)
