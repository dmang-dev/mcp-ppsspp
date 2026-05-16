#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PpssppClient } from "./ppsspp.js";
import { registerTools } from "./tools.js";

const HOST = process.env.PPSSPP_HOST ?? "127.0.0.1";
const PORT = parseInt(process.env.PPSSPP_PORT ?? "0", 10);

async function main() {
  if (!PORT) {
    process.stderr.write(
      `[mcp-ppsspp] FATAL: PPSSPP_PORT not set.\n` +
      `             PPSSPP's debugger WebSocket shares the disc-sharing port, which is dynamic.\n` +
      `             1. In PPSSPP: Settings > Tools > Developer Tools > Allow remote debugger\n` +
      `             2. The active address (e.g. ws://192.168.1.10:12345/debugger) will be shown\n` +
      `             3. Set PPSSPP_PORT (and PPSSPP_HOST if not localhost) and restart this server\n`,
    );
    process.exit(1);
  }

  const pp = new PpssppClient({ host: HOST, port: PORT });

  // Try to connect early so we fail fast with a clear error if PPSSPP isn't
  // running. Don't fail-stop the MCP transport though — let it stay up so
  // tool/list still works (good for inspectors and Glama introspection).
  pp.start().catch((err) => {
    process.stderr.write(
      `[mcp-ppsspp] could not reach PPSSPP at ${pp.describeTarget()}: ${err.message}\n` +
      `             Server still serving tools/list over stdio. Tool calls will fail until PPSSPP is up.\n`,
    );
  });

  const server = new Server(
    { name: "mcp-ppsspp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  registerTools(server, pp);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[mcp-ppsspp] MCP server ready (stdio)\n");

  // Clean shutdown when the MCP client (Claude Code, Claude Desktop, etc.)
  // disconnects. Without this, the WebSocket holds the event loop open.
  const shutdown = (reason: string) => {
    process.stderr.write(`[mcp-ppsspp] shutting down (${reason})\n`);
    pp.stop();
    process.exit(0);
  };
  process.stdin.on("end",   () => shutdown("stdin closed"));
  process.stdin.on("close", () => shutdown("stdin closed"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(`[mcp-ppsspp] fatal: ${err}\n`);
  process.exit(1);
});
