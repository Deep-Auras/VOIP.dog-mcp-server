import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createApiClient } from "./client/apiClient.js";
import { registerBitrixTools } from "./tools/bitrix.js";
import { registerThreeCxTools } from "./tools/threecx.js";
import { registerAuditTools } from "./tools/audit.js";
import { registerJobsTools } from "./tools/jobs.js";
import { registerSettingsTools } from "./tools/settings.js";
import { registerVoicemailTools } from "./tools/voicemail.js";
import { registerTranscriptTools } from "./tools/transcript.js";
import { registerCallerApiTools } from "./tools/callerapi.js";
import { registerGeminiTools } from "./tools/gemini.js";

export function createMcpServer(config) {
  // All logging goes to stderr so stdout stays clean for MCP framing.
  const log = config.debug
    ? (...args) => console.error("[voipdog-mcp]", ...args)
    : () => {};

  const server = new McpServer(
    { name: "voipdog-mcp", version: "0.1.0" },
    {
      instructions:
        "MCP server exposing the VOIP.dog backend (3CX call recordings, Bitrix24 CRM operations, " +
        "audit reports, and background jobs). Use these tools to investigate call records, " +
        "import missing 3CX activities into Bitrix, run audits, and inspect transcripts. " +
        "All operations are scoped to the authenticated user's organization.",
    }
  );

  const api = createApiClient(config, log);

  registerBitrixTools(server, api);
  registerThreeCxTools(server, api, config);
  registerAuditTools(server, api);
  registerJobsTools(server, api);
  registerSettingsTools(server, api);
  registerVoicemailTools(server, api, config);
  registerTranscriptTools(server, api);
  registerCallerApiTools(server, api);
  registerGeminiTools(server, api);

  return { server, log };
}
