// mcp-ppsspp — WebSocket client for PPSSPP's built-in debugger interface
// ────────────────────────────────────────────────────────────────────────
//
// PPSSPP exposes a JSON-RPC-ish API over WebSocket when "Allow remote
// debugger" is enabled in Settings → Tools → Developer Tools. Each
// request is a JSON object with at least { "event": "<category.method>",
// "ticket": "<correlation-id>" } plus method-specific params. The server
// echoes the ticket back on the response so we can correlate.
//
// Wire format (request):  {"event":"memory.read_u16","ticket":"t1","address":0x09000000}
// Wire format (response): {"event":"memory.read_u16","ticket":"t1","uintValue":42}
// Error response shape:   {"event":"error","ticket":"t1","message":"..."}
//
// The server also pushes async broadcasts (events without tickets) for
// things like game-state changes, stepping events, and log lines. We
// route ticketed responses back to their pending requests and ignore
// broadcasts for now (could surface them later via an EventEmitter).
//
// Connection URL: ws://<host>:<port>/debugger
// Subprotocol:    "debugger.ppsspp.org"
//
// Port defaults: PPSSPP's WebSocket shares the disc-sharing port, which
// is dynamic per install. The address shows in Settings → Tools →
// Developer Tools → Allow remote debugger. We accept it via env var
// (PPSSPP_HOST, PPSSPP_PORT) — no sensible auto-discovery default since
// the user has to opt in to enabling the debugger anyway.

import { WebSocket } from "ws";

interface PendingCmd {
  ticket:  string;
  resolve: (result: Record<string, unknown>) => void;
  reject:  (err: Error) => void;
}

export interface PpssppOptions {
  /** WebSocket host. Default 127.0.0.1. */
  host?: string;
  /** WebSocket port. PPSSPP's debugger uses the same port as disc sharing —
   *  see Settings → Tools → Developer Tools to find it. No safe default. */
  port?: number;
  /** Per-call timeout (ms). Default 10000. */
  timeoutMs?: number;
}

export class PpssppClient {
  private ws: WebSocket | null = null;
  /** Requests sent and awaiting a ticketed reply, keyed by ticket. */
  private inflight = new Map<string, PendingCmd>();
  private nextTicket = 1;
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  /** True once the WebSocket reaches OPEN state and protocol handshake completes. */
  private ready = false;
  /** Connection lifecycle promise — resolves once `ready` is true. */
  private readyPromise: Promise<void> | null = null;

  constructor(opts: PpssppOptions = {}) {
    this.host      = opts.host      ?? "127.0.0.1";
    this.port      = opts.port      ?? 0;
    this.timeoutMs = opts.timeoutMs ?? 10000;
    if (!this.port) {
      throw new Error("PPSSPP_PORT must be set — see Settings → Tools → Developer Tools in PPSSPP for the active port.");
    }
  }

  describeTarget(): string {
    return `ws://${this.host}:${this.port}/debugger (subprotocol: debugger.ppsspp.org)`;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.ready;
  }

  /**
   * Connect to PPSSPP's debugger WebSocket. Resolves when the socket is
   * open and ready for RPC. Rejects on connection failure or protocol
   * handshake error.
   */
  async start(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const url = `ws://${this.host}:${this.port}/debugger`;
      const ws = new WebSocket(url, "debugger.ppsspp.org");
      this.ws = ws;

      const onError = (err: Error) => {
        this.readyPromise = null;
        this.ws = null;
        reject(new Error(`PPSSPP WebSocket connection failed: ${err.message}`));
      };
      ws.once("error", onError);

      ws.on("open", () => {
        ws.off("error", onError);
        this.ready = true;
        process.stderr.write(`[mcp-ppsspp] connected to ${url}\n`);
        ws.on("error", (err) => {
          process.stderr.write(`[mcp-ppsspp] socket error: ${err.message}\n`);
        });
        ws.on("close", (code, reason) => {
          process.stderr.write(`[mcp-ppsspp] socket closed (code=${code}): ${reason.toString()}\n`);
          this.ready = false;
          this.ws = null;
          // Fail all in-flight requests
          for (const p of this.inflight.values()) {
            p.reject(new Error("PPSSPP WebSocket closed mid-request"));
          }
          this.inflight.clear();
        });
        ws.on("message", (data) => this.onMessage(data.toString("utf8")));
        resolve();
      });
    });
    return this.readyPromise;
  }

  stop(): void {
    this.ws?.close();
    this.ws = null;
    this.ready = false;
    this.readyPromise = null;
  }

  private onMessage(text: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(text);
    } catch (err) {
      process.stderr.write(`[mcp-ppsspp] bad JSON from PPSSPP: ${(err as Error).message}\n`);
      return;
    }
    const ticket = msg.ticket as string | undefined;
    if (!ticket) {
      // Async broadcast — game state change, log line, stepping event, etc.
      // Not currently surfaced to MCP clients.
      if (process.env.MCP_PPSSPP_DEBUG) {
        process.stderr.write(`[trace] broadcast: ${text.slice(0, 200)}\n`);
      }
      return;
    }
    const pending = this.inflight.get(ticket);
    if (!pending) {
      process.stderr.write(`[mcp-ppsspp] unknown ticket from PPSSPP: ${ticket}\n`);
      return;
    }
    this.inflight.delete(ticket);
    if (msg.event === "error") {
      pending.reject(new Error(`PPSSPP error: ${msg.message ?? "(no message)"}`));
    } else {
      pending.resolve(msg);
    }
  }

  /**
   * Lazy connection guard used by both call() and fireAndForget(). If the
   * socket isn't currently open, attempts to (re)connect, throwing a
   * tool-call-shaped error on failure that points at the right fix.
   *
   * Why this is safe under concurrent callers: start() is memoized by
   * `readyPromise` — multiple in-flight ensureConnected() calls share a
   * single underlying connect attempt, and on failure start() resets
   * readyPromise so the NEXT call can retry rather than getting a stale
   * rejection forever.
   */
  private async ensureConnected(): Promise<void> {
    if (this.isConnected()) return;
    try {
      await this.start();
    } catch (err) {
      throw new Error(
        `PPSSPP not reachable at ${this.describeTarget()}: ${(err as Error).message}.  ` +
        `Make sure PPSSPP is running with "Allow remote debugger" enabled in ` +
        `Settings → Tools → Developer Tools.`,
      );
    }
  }

  /**
   * Send a fire-and-forget request — used for events that PPSSPP documents
   * as having "no immediate response" (e.g. cpu.stepping, cpu.resume).
   * Those events ack via an async broadcast (no ticket) some time later;
   * `call()` would hang waiting for a ticketed reply that never arrives.
   *
   * Caller usually follows this with `waitForState()` polling on cpu.status
   * (or game.status) to detect when the state change actually took effect.
   */
  async fireAndForget(event: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.ensureConnected();
    const msg = JSON.stringify({ event, ...params });
    if (process.env.MCP_PPSSPP_DEBUG) {
      process.stderr.write(`[trace] TX (fire&forget): ${msg}\n`);
    }
    this.ws!.send(msg);
  }

  /**
   * Poll cpu.status (which IS synchronous) every `intervalMs` until
   * `predicate` returns true, then resolve. Times out after `timeoutMs`.
   *
   * Used to detect when fire-and-forget commands (cpu.stepping / cpu.resume)
   * have actually taken effect, since they don't ticket-reply.
   */
  async waitForState(predicate: (status: { stepping?: boolean; paused?: boolean; pc?: number; ticks?: number }) => boolean, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
    const timeoutMs  = opts.timeoutMs  ?? 3000;
    const intervalMs = opts.intervalMs ?? 50;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.call<{ stepping?: boolean; paused?: boolean; pc?: number; ticks?: number }>("cpu.status");
      if (predicate(status)) return;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`waitForState timed out after ${timeoutMs}ms`);
  }

  /**
   * Send a request and wait for the ticketed response. `event` is the
   * PPSSPP method name (e.g. "memory.read_u16"). `params` is merged into
   * the request object alongside `event` and `ticket`.
   *
   * The returned object is the FULL response (including `event` and
   * `ticket` fields); callers usually want a specific field like
   * `value` or `base64` — pull it from the result.
   */
  async call<T extends Record<string, unknown> = Record<string, unknown>>(
    event: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    // Auto-(re)connect on demand. PPSSPP can be launched, closed, relaunched
    // at any point during the MCP server's lifetime; ensureConnected() will
    // bring the socket back up (or throw a clear error if PPSSPP isn't
    // reachable). Without this, a single failed connect at MCP boot would
    // leave every subsequent tool call broken until MCP-client restart.
    await this.ensureConnected();
    return new Promise<T>((resolve, reject) => {
      const ticket = `t${this.nextTicket++}`;
      const pending: PendingCmd = {
        ticket,
        resolve: (r) => resolve(r as T),
        reject,
      };

      const timer = setTimeout(() => {
        this.inflight.delete(ticket);
        reject(new Error(
          `PPSSPP call "${event}" timed out (${this.timeoutMs}ms) — ` +
          `is PPSSPP running with "Allow remote debugger" enabled?`,
        ));
      }, this.timeoutMs);
      const origResolve = pending.resolve, origReject = pending.reject;
      pending.resolve = (r) => { clearTimeout(timer); origResolve(r); };
      pending.reject  = (e) => { clearTimeout(timer); origReject(e); };

      this.inflight.set(ticket, pending);
      const msg = JSON.stringify({ event, ticket, ...params });
      if (process.env.MCP_PPSSPP_DEBUG) {
        process.stderr.write(`[trace] TX: ${msg}\n`);
      }
      this.ws!.send(msg);
    });
  }
}
