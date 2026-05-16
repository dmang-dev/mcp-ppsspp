// Verify v0.1.3 screenshot behaviour: prove gpu.buffer.renderColor (the new
// default 'render' source) works, and that gpu.buffer.screenshot (the opt-in
// 'output' source) either works or fails *cleanly* — i.e. it should NOT
// crash PPSSPP from this script's perspective. If PPSSPP dies entirely
// during the 'output' test, that's the upstream bug
// (hrydgard/ppsspp#21683) firing and we'll see the WebSocket close
// mid-request — script reports it as such, not a script bug.
//
// Usage: PPSSPP_PORT=<port> node scripts/verify-screenshot.cjs
//
// Prereqs:
//   - PPSSPP running with "Allow remote debugger" enabled
//     (Settings → Tools → Developer Tools)
//   - A PSP game loaded (so the framebuffers have content to read)
//   - The port from the developer tools dialog passed via env
//
// Outputs:
//   - C:/temp/ppsspp-verify-render.png  (from gpu.buffer.renderColor)
//   - C:/temp/ppsspp-verify-output.png  (from gpu.buffer.screenshot, if it
//                                        didn't crash)
//
// Exit codes:
//   0 — render path works (the default; this is the main thing v0.1.3 ships)
//   1 — render path failed (regression — investigate)
//   2 — PPSSPP not reachable / no port
// Note: 'output' path failure does NOT cause non-zero exit; it's expected to
// be fragile per the v0.1.3 known-limitation note.

"use strict";

const path = require("node:path");
const fs   = require("node:fs");
const { PpssppClient } = require(path.resolve(__dirname, "..", "dist", "ppsspp.js"));

const PORT = parseInt(process.env.PPSSPP_PORT || "0", 10);
const HOST = process.env.PPSSPP_HOST || "127.0.0.1";
const OUT_DIR = process.env.PPSSPP_VERIFY_OUT || "C:/temp";

if (!PORT) {
  console.error("PPSSPP_PORT not set. See Settings → Tools → Developer Tools in PPSSPP for the active port.");
  process.exit(2);
}

async function captureWithSource(pp, event, label, outPath) {
  console.log(`\n=== ${label}: ${event} ===`);
  const statusBefore = await pp.call("cpu.status");
  const wasStepping = !!statusBefore.stepping;

  if (!wasStepping) {
    await pp.fireAndForget("cpu.stepping");
    await pp.waitForState((s) => s.stepping === true);
  }

  let ok = false;
  let bytes = 0;
  try {
    const r = await pp.call(event, { type: "base64" });
    let b64 = r.base64;
    if (!b64 && r.uri) {
      const m = /^data:image\/png;base64,(.*)$/.exec(r.uri);
      if (m) b64 = m[1];
    }
    if (b64) {
      fs.writeFileSync(outPath, Buffer.from(b64, "base64"));
      bytes = Buffer.byteLength(b64, "base64");
      console.log(`  PASS — saved ${outPath} (${bytes} bytes decoded)`);
      ok = true;
    } else {
      console.log(`  FAIL — no image data: ${JSON.stringify(r).slice(0, 200)}`);
    }
  } catch (err) {
    // The interesting failure mode for 'output' is the WebSocket closing
    // mid-request — PpssppClient surfaces that as "PPSSPP WebSocket closed
    // mid-request". That means PPSSPP itself crashed (upstream #21683).
    if (/closed mid-request/i.test(err.message)) {
      console.log(`  CRASH — PPSSPP process died (upstream bug #21683 fired).`);
      console.log(`          MCP server will auto-reconnect on next call (v0.1.2 fix).`);
    } else {
      console.log(`  FAIL — ${err.message}`);
    }
  }

  if (!wasStepping) {
    try {
      await pp.fireAndForget("cpu.resume");
      await pp.waitForState((s) => s.stepping === false, { timeoutMs: 2000 });
    } catch { /* best-effort; if PPSSPP died, this throws too */ }
  }

  return ok;
}

(async () => {
  const pp = new PpssppClient({ host: HOST, port: PORT });

  console.log(`=== connecting to ${pp.describeTarget()} ===`);
  try {
    await pp.start();
  } catch (err) {
    console.error("FAIL: connection — " + err.message);
    process.exit(2);
  }
  console.log("  connected.");

  // Confirm a game is loaded — both readback paths need framebuffer content.
  const status = await pp.call("game.status");
  if (!status.game) {
    console.log("\nWARN: no game loaded. Load a PSP game in PPSSPP, then re-run.");
    console.log("      Without a game, both sources will return 'no image data'.");
  } else {
    console.log(`  game loaded: ${status.game.title || "(untitled)"} (${status.game.id || "?"})`);
  }

  // Test 1: the new default — gpu.buffer.renderColor.
  // This is what ppsspp_screenshot uses now without an explicit source param.
  const renderOk = await captureWithSource(
    pp,
    "gpu.buffer.renderColor",
    "render source (default in v0.1.3)",
    path.join(OUT_DIR, "ppsspp-verify-render.png"),
  );

  // Test 2: the opt-in path — gpu.buffer.screenshot.
  // This is what ppsspp_screenshot uses with source: 'output'.
  // Expected to either work cleanly OR crash PPSSPP (upstream #21683).
  const outputOk = await captureWithSource(
    pp,
    "gpu.buffer.screenshot",
    "output source (opt-in, can crash PPSSPP)",
    path.join(OUT_DIR, "ppsspp-verify-output.png"),
  );

  console.log("\n=== summary ===");
  console.log(`  render (default):       ${renderOk ? "PASS" : "FAIL"}`);
  console.log(`  output (opt-in):        ${outputOk ? "PASS" : "FAIL/CRASH (per upstream #21683)"}`);

  pp.stop();

  // Only the render path failing is a hard regression — that's the default,
  // and v0.1.3's whole point is that it works reliably.
  process.exit(renderOk ? 0 : 1);
})().catch((err) => {
  console.error("UNEXPECTED:", err);
  process.exit(1);
});
