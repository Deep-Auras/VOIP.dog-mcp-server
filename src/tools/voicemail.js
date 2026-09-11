import { z } from "zod";
import { safeHandler } from "./_helpers.js";

export function registerVoicemailTools(server, api, config) {
  server.registerTool(
    "voicemail_list",
    {
      title: "List voicemails",
      description: "List voicemails with optional date / extension / phone filter.",
      inputSchema: {
        top: z.number().int().positive().max(500).optional(),
        skip: z.number().int().nonnegative().optional(),
        from: z.string().optional().describe("ISO date lower bound"),
        to: z.string().optional().describe("ISO date upper bound"),
        extension: z.string().optional(),
        phone: z.string().optional(),
      },
    },
    safeHandler((args) => api.get("/voicemails", { query: args }))
  );

  server.registerTool(
    "voicemail_search_keyword",
    {
      title: "Keyword search transcribed voicemails",
      description:
        "Typesense BM25 keyword search over the vmTranscriptions collection.",
      inputSchema: {
        q: z.string().describe("Keyword query"),
        phone: z.string().optional(),
        extension: z.string().optional(),
        page: z.number().int().positive().optional(),
        per_page: z.number().int().positive().max(100).optional(),
      },
    },
    safeHandler((args) =>
      api.get("/voicemail-search/keyword", { query: args })
    )
  );

  server.registerTool(
    "voicemail_search_hybrid",
    {
      title: "Hybrid (BM25 + vector) search transcribed voicemails",
      description:
        "Hybrid semantic + keyword search; falls back to keyword-only when embeddings are unavailable.",
      inputSchema: {
        q: z.string(),
        extension: z.string().optional(),
        page: z.number().int().positive().optional(),
        per_page: z.number().int().positive().max(100).optional(),
      },
    },
    safeHandler((args) =>
      api.get("/voicemail-search/hybrid", { query: args })
    )
  );

  server.registerTool(
    "voicemail_get_audio_url",
    {
      title: "Build authenticated URL for voicemail audio",
      description:
        "Returns a fully-qualified URL to fetch a voicemail audio file. The URL still requires the same Bearer token to access.",
      inputSchema: { filename: z.string() },
    },
    safeHandler(({ filename }) => ({
      url: `${config.baseUrl}/voicemails/audio/${encodeURIComponent(filename)}`,
      authHeader: "Bearer <session token>",
      note: "Audio bytes are not returned through MCP — fetch directly with your Bearer token.",
    }))
  );

  server.registerTool(
    "voicemail_match",
    {
      title: "Match voicemails to Bitrix records",
      description:
        "Run match logic correlating voicemail entries with Bitrix24 contacts/companies.",
      inputSchema: {
        items: z
          .array(z.record(z.any()))
          .describe("Voicemail entries to match"),
      },
    },
    safeHandler(({ items }) => api.post("/voicemails/match", { items }))
  );

  server.registerTool(
    "voicemail_callback_tracker",
    {
      title: "Voicemail callback tracker (last 7 days)",
      description:
        "Fetches voicemails from the last 7 days and reports which ones have and have not been called back yet. " +
        "Buckets un-returned voicemails by age (24h / 48h / 7d) so agents can prioritize follow-ups. " +
        "Optional `extension` filter narrows to a single destination extension. " +
        "Also returns the list of already-called-back items for reporting.",
      inputSchema: {
        extension: z
          .string()
          .optional()
          .describe("Destination extension DN to filter by (e.g. \"17\")"),
      },
    },
    safeHandler(({ extension }) =>
      api.get("/voicemail-callback", {
        query: extension ? { extension } : {},
      })
    )
  );
}
