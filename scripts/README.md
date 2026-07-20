# scripts/

Verification scripts for development. Each runs against a live PPSSPP instance
with the debugger enabled.

## Files

- **`smoke.cjs`** — basic liveness probe: ping, get_info, read a few bytes.
  Quickest "is everything wired up?" check.
- **`verify-reconnect.cjs`** — kills/restarts PPSSPP under the client to
  confirm reconnect logic survives. Regression guard for the WebSocket reconnect
  path.
- **`verify-screenshot.cjs`** — captures a framebuffer and validates the PNG
  is non-empty and decodable. Regression guard for screenshot tool.

## Usage

```bash
PPSSPP_PORT=12345 npm run smoke
PPSSPP_PORT=12345 npm run verify:reconnect
PPSSPP_PORT=12345 npm run verify:screenshot
```

Set `PPSSPP_PORT` to whatever PPSSPP's Developer Tools dialog shows.
