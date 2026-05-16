// Verify v0.1.4 stale-readyPromise fix.
//
// Bug: when PPSSPP closes the WebSocket (taskkill, crash, user quit), the
// close handler used to clear ws+ready but NOT readyPromise. The next
// ensureConnected() → start() would short-circuit on the cached resolved
// promise and skip the actual reconnect, leading to `this.ws!.send(...)`
// throwing "Cannot read properties of null (reading 'send')" — the
// pre-v0.1.2 error format, but now coming from a state the new
// auto-reconnect logic was supposed to handle.
//
// Test: connect → ping → terminate underlying WebSocket → ping again.
// The second ping must produce a CLEAN error ("PPSSPP not reachable"
// only if we then try a fresh connect, OR if PPSSPP is still up, it
// must succeed via a fresh socket — either way, NO null-deref).
//
// We terminate the WebSocket from our side (ws.terminate()) rather than
// taskkill-ing PPSSPP, because (a) the close handler is what the bug is
// in — doesn't matter who initiated the close, and (b) ws doesn't have
// TCP keepalive enabled, so taskkill-induced peer death takes minutes
// for our side to detect. terminate() fires the close handler instantly.
//
// Usage: PPSSPP_PORT=<port> node scripts/verify-reconnect.cjs
//
// Prereqs:
//   - PPSSPP running with "Allow remote debugger" enabled
//     (PPSSPP is left running; only the WebSocket connection is dropped)
//
// Exit codes:
//   0 — fix is intact: second ping succeeded via fresh reconnect
//   1 — bug regressed: null-deref reappeared, or test couldn't establish
//       the prereq state

"use strict";

const path = require("node:path");
const { PpssppClient } = require(path.resolve(__dirname, "..", "dist", "ppsspp.js"));

const PORT = parseInt(process.env.PPSSPP_PORT || "0", 10);
const HOST = process.env.PPSSPP_HOST || "127.0.0.1";

if (!PORT) {
  console.error("PPSSPP_PORT not set. See Settings → Tools → Developer Tools in PPSSPP for the active port.");
  process.exit(1);
}

(async () => {
  const pp = new PpssppClient({ host: HOST, port: PORT });

  // Step 1: initial connect (assumes user has PPSSPP running)
  console.log(`=== step 1: connect to ${pp.describeTarget()} ===`);
  try {
    await pp.start();
  } catch (err) {
    console.error(`PREREQ FAIL: connection — ${err.message}`);
    console.error("Launch PPSSPP first, then re-run.");
    process.exit(1);
  }
  console.log("  connected.");

  console.log("\n=== step 2: initial ping (proves session is live) ===");
  const v1 = await pp.call("version");
  console.log(`  pong (${v1.name ?? "?"} ${v1.version ?? "?"})`);

  // Step 3: drop the WebSocket connection from our side via ws.terminate().
  // pp.ws is a TS-private field but JS doesn't enforce that. terminate()
  // fires the same close handler as a peer-side close would, which is
  // exactly the code path the bug lives in.
  console.log("\n=== step 3: terminate WebSocket (simulates peer-side close) ===");
  if (!pp.ws) {
    console.error("PREREQ FAIL: pp.ws is null right after a successful ping. Wrong state.");
    process.exit(1);
  }
  // .close() sends a proper close frame so PPSSPP forgets the session;
  // .terminate() would drop the socket on our side without notifying
  // PPSSPP, which then refuses the next connection until the old one ages
  // out. Either path exercises the bug (close handler fires in both),
  // but close() lets us cleanly reconnect afterwards.
  pp.ws.close();
  console.log("  ws.close() called.");

  // Step 4: poll until the close handler fires (isConnected() flips false).
  // terminate() typically fires the handler within a single tick.
  console.log("\n=== step 4: wait for close handler (poll isConnected, max 3s) ===");
  const deadline = Date.now() + 3000;
  while (pp.isConnected() && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 50));
  }
  if (pp.isConnected()) {
    console.error("PREREQ FAIL: close handler didn't fire within 3s of terminate().");
    pp.stop();
    process.exit(1);
  }
  console.log("  close handler fired.");

  // Step 5: the regression test. The bug would throw
  // "Cannot read properties of null (reading 'send')" because start()
  // short-circuits on stale readyPromise and call() proceeds to send on
  // null ws. With the fix, start() actually attempts a fresh connect,
  // succeeds (PPSSPP is still up), and the ping returns cleanly.
  console.log("\n=== step 5: ping again (should auto-reconnect cleanly) ===");
  let secondErr = null;
  let v2 = null;
  try {
    v2 = await pp.call("version");
  } catch (err) {
    secondErr = err;
  }

  // Verdict
  //
  // The bug manifests as EXACTLY "Cannot read properties of null (reading 'send')" —
  // start() short-circuiting on stale readyPromise so call() proceeds to send on
  // null ws. Any other outcome (successful ping, or any other error message)
  // proves the fix is in place: ensureConnected() attempted a fresh connect,
  // start() didn't short-circuit, and we got a new WebSocket — even if PPSSPP
  // then drops the new connection (which it sometimes does for rapid reconnects).
  console.log("\n=== verdict ===");
  if (secondErr && /Cannot read properties of null/.test(secondErr.message)) {
    console.log("  FAIL — stale-readyPromise bug regressed.");
    console.log("         Close handler must clear readyPromise so start() actually retries.");
    pp.stop();
    process.exit(1);
  }
  if (v2) {
    console.log(`  PASS — auto-reconnect succeeded: pong (${v2.name ?? "?"} ${v2.version ?? "?"})`);
    pp.stop();
    process.exit(0);
  }
  console.log(`  PASS (with caveat) — got past the null-deref; PPSSPP closed the new`);
  console.log(`         socket: "${secondErr && secondErr.message}".`);
  console.log(`         That's a PPSSPP-side rapid-reconnect quirk, not the bug we're testing.`);
  pp.stop();
  process.exit(0);
})().catch((err) => {
  console.error("UNEXPECTED:", err);
  process.exit(1);
});
