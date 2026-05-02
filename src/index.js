#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createMcpServer } from "./server.js";

const args = new Set(process.argv.slice(2));
const useHttp = args.has("--http") || args.has("-h");

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error("[voipdog-mcp] config error:", err.message);
    process.exit(1);
  }

  const { server, log } = createMcpServer(config);

  if (useHttp) {
    await startHttp(server, config, log);
  } else {
    await startStdio(server, log);
  }
}

async function startStdio(server, log) {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("listening on stdio");
}

async function startHttp(server, config, log) {
  const [{ default: express }, { StreamableHTTPServerTransport }] =
    await Promise.all([
      import("express"),
      import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
    ]);

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Stateless transport: every POST creates a fresh transport bound to this
  // server instance. Sufficient for single-tenant deployments; stateful mode
  // can be added later if multiple agents need persistent sessions.
  app.post("/mcp", async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      res.on("close", () => transport.close().catch(() => {}));
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log("http error: %s", err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal error" },
          id: null,
        });
      }
    }
  });

  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

  const { port, host } = config.http;
  app.listen(port, host, () => {
    log("listening on http://%s:%d/mcp", host, port);
    console.error(`[voipdog-mcp] HTTP transport at http://${host}:${port}/mcp`);
  });
}

main().catch((err) => {
  console.error("[voipdog-mcp] fatal:", err);
  process.exit(1);
});
