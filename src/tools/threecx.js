import { z } from "zod";
import { safeHandler } from "./_helpers.js";

export function registerThreeCxTools(server, api, config) {
  server.registerTool(
    "threecx_list_recordings",
    {
      title: "List 3CX call recordings",
      description:
        "List 3CX call recordings with optional date range and free-text query. Supports paging via top/skip.",
      inputSchema: {
        from: z
          .string()
          .optional()
          .describe("ISO date or yyyy-mm-dd inclusive lower bound"),
        to: z.string().optional().describe("ISO date inclusive upper bound"),
        q: z.string().optional().describe("Free-text search"),
        top: z.number().int().positive().max(500).optional(),
        skip: z.number().int().nonnegative().optional(),
        count: z.boolean().optional(),
        orderby: z.string().optional(),
      },
    },
    safeHandler((args) => api.get("/3cx/recordings", { query: args }))
  );

  server.registerTool(
    "threecx_get_recording_url",
    {
      title: "Get authenticated URL for a 3CX recording",
      description:
        "Build a fully-qualified URL to stream/download a 3CX recording by its recId. The URL requires the same Bearer token to fetch — agents should not log it.",
      inputSchema: {
        recId: z.string(),
        stream: z
          .boolean()
          .optional()
          .describe("If true, append ?stream=true for streaming mode"),
      },
    },
    safeHandler(({ recId, stream }) => {
      const qs = stream ? "?stream=true" : "";
      return {
        url: `${config.baseUrl}/3cx/recording/${encodeURIComponent(recId)}${qs}`,
        authHeader: "Bearer <session token>",
        note: "Recording bytes are NOT returned through MCP — fetch directly with your Bearer token.",
      };
    })
  );
}
