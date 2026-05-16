// One-shot smoke test for mcp-ppsspp.
// Usage: PPSSPP_PORT=<port> node scripts/smoke.cjs
//
// What it does:
//   1. Connect to PPSSPP's WebSocket debugger
//   2. ping (version)
//   3. game.status (game info + run state)
//   4. Read a known PSP RAM byte
//   5. Capture a screenshot to C:/temp/ppsspp-smoke.png
//   6. List breakpoints (should be empty)
//   7. Exit cleanly
//
// Prereqs:
//   - PPSSPP running with "Allow remote debugger" enabled
//     (Settings → Tools → Developer Tools)
//   - The PORT shown in PPSSPP's developer tools dialog, passed as env var
//   - Any PSP ISO/EBOOT loaded (so screenshot has content)

"use strict";

const path = require("node:path");
const fs   = require("node:fs");
const { PpssppClient } = require(path.resolve(__dirname, "..", "dist", "ppsspp.js"));

const PORT = parseInt(process.env.PPSSPP_PORT || "0", 10);
const HOST = process.env.PPSSPP_HOST || "127.0.0.1";

if (!PORT) {
  console.error("PPSSPP_PORT not set. See Settings → Tools → Developer Tools in PPSSPP for the active port.");
  process.exit(2);
}

(async () => {
  const pp = new PpssppClient({ host: HOST, port: PORT });

  console.log(`=== connecting to ${pp.describeTarget()} ===`);
  try {
    await pp.start();
  } catch (err) {
    console.error("FAIL: connection — " + err.message);
    process.exit(1);
  }
  console.log("  connected.\n");

  // 1. ping (version)
  console.log("=== ping (version) ===");
  const v = await pp.call("version");
  console.log("  " + JSON.stringify(v, null, 2));

  // 2. game.status
  console.log("\n=== game.status ===");
  const status = await pp.call("game.status");
  console.log("  " + JSON.stringify(status, null, 2));

  // 3. memory.read_u8 — try user RAM base (game start often near here)
  console.log("\n=== memory.read_u8 @ 0x08800000 (user RAM base) ===");
  try {
    const r = await pp.call("memory.read_u8", { address: 0x08800000 });
    console.log("  " + JSON.stringify(r));
  } catch (e) {
    console.log("  (skipped — " + e.message + ")");
  }

  // 4. memory.read (range) — try a small block of user RAM
  console.log("\n=== memory.read 16 bytes @ 0x08800000 ===");
  try {
    const r = await pp.call("memory.read", { address: 0x08800000, size: 16 });
    if (r.base64) {
      const bytes = Buffer.from(r.base64, "base64");
      console.log("  " + Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(" "));
    } else {
      console.log("  (no base64 in response: " + JSON.stringify(r) + ")");
    }
  } catch (e) {
    console.log("  (skipped — " + e.message + ")");
  }

  // 5. screenshot — must pause first (gpu.buffer.screenshot requires stepping)
  console.log("\n=== gpu.buffer.screenshot (with auto-pause/resume) ===");
  try {
    await pp.fireAndForget("cpu.stepping");
    await pp.waitForState((s) => s.stepping === true);
    try {
      const r = await pp.call("gpu.buffer.screenshot", { type: "base64" });
      let b64 = r.base64;
      if (!b64 && r.uri) {
        const m = /^data:image\/png;base64,(.*)$/.exec(r.uri);
        if (m) b64 = m[1];
      }
      if (b64) {
        const screenshotPath = "C:/temp/ppsspp-smoke.png";
        fs.writeFileSync(screenshotPath, Buffer.from(b64, "base64"));
        console.log(`  saved to ${screenshotPath} (${Buffer.byteLength(b64, "base64")} bytes decoded)`);
      } else {
        console.log("  (no screenshot data: " + JSON.stringify(r).slice(0, 200) + ")");
      }
    } finally {
      try { await pp.fireAndForget("cpu.resume"); await pp.waitForState((s) => s.stepping === false, { timeoutMs: 2000 }); } catch {}
    }
  } catch (e) {
    console.log("  (skipped — " + e.message + ")");
  }

  // 5b. get all registers
  console.log("\n=== cpu.getAllRegs (first category only) ===");
  try {
    await pp.fireAndForget("cpu.stepping");
    await pp.waitForState((s) => s.stepping === true);
    try {
      const r = await pp.call("cpu.getAllRegs");
      const cats = r.categories || [];
      if (cats.length > 0) {
        const c0 = cats[0];
        console.log(`  ${c0.name}: ${(c0.registerNames || []).length} registers`);
        const names = c0.registerNames || [];
        const vals = c0.uintValues || [];
        for (let i = 0; i < Math.min(8, names.length); i++) {
          console.log(`    ${names[i].padEnd(8)} = 0x${(vals[i] || 0).toString(16).padStart(8, "0").toUpperCase()}`);
        }
        if (names.length > 8) console.log(`    ... (+${names.length - 8} more)`);
      } else {
        console.log("  (no categories)");
      }
    } finally {
      try { await pp.fireAndForget("cpu.resume"); await pp.waitForState((s) => s.stepping === false, { timeoutMs: 2000 }); } catch {}
    }
  } catch (e) {
    console.log("  (skipped — " + e.message + ")");
  }

  // 5c. memory write round-trip (write a sentinel, read it back, confirm)
  console.log("\n=== memory.write_u32 + read_u32 round-trip ===");
  try {
    const testAddr = 0x08800000;
    const testVal = 0xDEADBEEF;
    await pp.call("memory.write_u32", { address: testAddr, value: testVal });
    const r = await pp.call("memory.read_u32", { address: testAddr });
    if (r.value === testVal) {
      console.log(`  wrote 0x${testVal.toString(16).toUpperCase()} → 0x${testAddr.toString(16).toUpperCase()}, read back ✓`);
    } else {
      console.log(`  MISMATCH — wrote 0x${testVal.toString(16).toUpperCase()}, read 0x${(r.value || 0).toString(16).toUpperCase()}`);
    }
  } catch (e) {
    console.log("  (skipped — " + e.message + ")");
  }

  // 6. breakpoint list
  console.log("\n=== cpu.breakpoint.list ===");
  try {
    const r = await pp.call("cpu.breakpoint.list");
    console.log("  " + JSON.stringify(r));
  } catch (e) {
    console.log("  (skipped — " + e.message + ")");
  }

  console.log("\n=== smoke complete ===");
  pp.stop();
  process.exit(0);
})().catch(err => {
  console.error("FAIL:", err.stack || err.message);
  process.exit(1);
});
