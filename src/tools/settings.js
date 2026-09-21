import { z } from "zod";
import { safeHandler } from "./_helpers.js";

export function registerSettingsTools(server, api) {
  server.registerTool(
    "settings_get",
    {
      title: "Get masked org + system settings",
      description:
        "Read combined org/system configuration. Secrets are masked (clientSecret, apiKey replaced with hasApiKey:boolean).",
      inputSchema: {},
    },
    safeHandler(() => api.get("/settings"))
  );

  server.registerTool(
    "org_current",
    {
      title: "Get the current organization",
      description:
        "Which organization this token operates as — name, id, tier, status. " +
        "Useful for confirming scope before making writes, since every other " +
        "tool is implicitly scoped to this org.",
      inputSchema: {},
    },
    safeHandler(() => api.get("/org/current"))
  );

  server.registerTool(
    "settings_validate_bitrix",
    {
      title: "Validate a Bitrix webhook URL",
      description:
        "Test that a Bitrix24 webhook URL responds correctly. Does not persist the value.",
      inputSchema: { webhookUrl: z.string().url() },
    },
    safeHandler((body) => api.post("/settings/validate/bitrix", body))
  );

  server.registerTool(
    "settings_validate_3cx",
    {
      title: "Validate 3CX OAuth credentials",
      description:
        "Test 3CX OAuth2 client-credentials login. Does not persist the values.",
      inputSchema: {
        baseUrl: z.string().url(),
        clientId: z.string(),
        clientSecret: z.string(),
      },
    },
    safeHandler((body) => api.post("/settings/validate/3cx", body))
  );
}
