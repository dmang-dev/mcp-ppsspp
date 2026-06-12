# Dockerfile — primarily for the Glama MCP registry (https://glama.ai/mcp/servers).
#
# Builds the MCP server and runs it over stdio. The server starts cleanly
# WITHOUT BizHawk present: it binds the TCP listener and waits, and still
# serves tools/list over stdio. That's exactly what Glama's "start + respond
# to introspection" check needs.
#
# For actual use you don't need Docker — `npm install -g mcp-bizhawk` and
# point a running BizHawk at it (--socket_ip / --socket_port flags + load
# lua/bridge.lua in the Lua Console). See README.md.

FROM node:22-trixie-slim@sha256:8cd0ffd483b64585c6d135364bea5f937ff40cd3da431789af011f9ee8d55af0
WORKDIR /app

# Install dependencies. --ignore-scripts skips the `prepare` hook; we run the
# build explicitly below so the layer caching is predictable.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Compile TypeScript -> dist/
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Ship the Lua bridge alongside (not used by the Node server itself — it's
# loaded into BizHawk — but handy if someone docker-cp's it out).
COPY lua/ ./lua/

# The MCP server speaks JSON-RPC over stdio.
ENTRYPOINT ["node", "dist/index.js"]
