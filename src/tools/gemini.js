import { z } from "zod";
import { safeHandler } from "./_helpers.js";

/**
 * Gemini-backed helpers exposed by the VOIP.dog backend.
 *
 * Note this is the backend's own Gemini integration (server-side key, PII
 * masking, blacklist validation) — not a general-purpose LLM passthrough.
 */
export function registerGeminiTools(server, api) {
  server.registerTool(
    "gemini_extract_contact",
    {
      title: "Extract contact details from a call description",
      description:
        "Pull structured contact fields (name, company, email, address, …) out of " +
        "a free-text call description or transcript, using the backend's Gemini " +
        "integration. PII masking and blacklist validation are applied " +
        "server-side. Useful before bitrix_create_contact when you only have a " +
        "call record's narrative text.",
      inputSchema: {
        description: z
          .string()
          .describe("Call description or transcript text to extract from"),
      },
    },
    safeHandler(({ description }) => api.post("/gemini/extract-contact", { description }))
  );

  server.registerTool(
    "gemini_test",
    {
      title: "Test the Gemini integration",
      description: "Non-destructive check that the configured Gemini key works.",
      inputSchema: {},
    },
    safeHandler(() => api.get("/gemini/test"))
  );
}
