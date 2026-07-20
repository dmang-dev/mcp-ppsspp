# src/

TypeScript source for the `mcp-ppsspp` MCP server (Node.js). Compiled into
`../dist/` by `tsc` — that's what the published `mcp-ppsspp` bin runs.

## Files

- **`index.ts`** — stdio MCP entrypoint. Reads `PPSSPP_HOST` /
  `PPSSPP_PORT` (port required, no default), opens the WebSocket to PPSSPP's
  debugger, registers tools, awaits MCP requests on stdio.
- **`ppsspp.ts`** — WebSocket client speaking PPSSPP's `debugger.ppsspp.org`
  subprotocol. Translates each MCP tool call to a debugger JSON-RPC request.
  Auto-reconnects if PPSSPP restarts.
- **`tools.ts`** — registers every MCP tool against the SDK server. PSP-specific:
  two press tools (`ppsspp_press_buttons` persistent vs.
  `ppsspp_press_button` auto-release), MIPS register access, CPU breakpoints.

## Build

```bash
npm run dev      # tsc --watch
npm run build    # one-shot
```

Output goes to `../dist/index.js`.
