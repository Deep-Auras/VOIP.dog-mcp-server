import { z } from "zod";
import { safeHandler } from "./_helpers.js";

/**
 * CallerAPI: phone-number reputation, spam scoring and spam reporting.
 *
 * This whole surface was previously unreachable from MCP even though the
 * backend has had it all along — agents auditing call records had no way to
 * ask "is this number spam?" or to record a determination.
 *
 * Read tools are safe. The write tools (report / update / delete) change
 * shared org state and are described accordingly.
 */
export function registerCallerApiTools(server, api) {
  server.registerTool(
    "callerapi_spam_score",
    {
      title: "Get spam score for a phone number",
      description:
        "Look up a phone number's spam/reputation score via CallerAPI. Read-only.",
      inputSchema: {
        phoneNumber: z.string().describe("Phone number to score (E.164 or raw digits)"),
      },
    },
    safeHandler(({ phoneNumber }) =>
      api.get("/callerapi/spam-score", { query: { phoneNumber } })
    )
  );

  server.registerTool(
    "callerapi_is_reported",
    {
      title: "Check whether a number has already been reported as spam",
      description:
        "Returns whether this organization has already filed a spam report for the " +
        "number. Check this before calling callerapi_report_spam to avoid duplicates.",
      inputSchema: { phoneNumber: z.string() },
    },
    safeHandler(({ phoneNumber }) =>
      api.get(`/callerapi/is-reported/${encodeURIComponent(phoneNumber)}`)
    )
  );

  server.registerTool(
    "callerapi_list_reported_numbers",
    {
      title: "List numbers reported as spam",
      description: "All spam reports filed by this organization. Read-only.",
      inputSchema: {},
    },
    safeHandler(() => api.get("/callerapi/reported-numbers"))
  );

  server.registerTool(
    "callerapi_enrich_record",
    {
      title: "Enrich an audit record with CallerAPI data",
      description:
        "Attach caller-reputation data to a specific audit record, addressed by its " +
        "chunk document id and array index (the `_metadata` fields on records " +
        "returned by audit_data_for_job).",
      inputSchema: {
        chunkDocId: z.string().describe("_metadata.chunkDocId of the audit record"),
        arrayIndex: z.number().int().nonnegative().describe("_metadata.arrayIndex"),
        phoneNumber: z.string(),
      },
    },
    safeHandler((body) => api.post("/callerapi/enrich-record", body))
  );

  server.registerTool(
    "callerapi_report_spam",
    {
      title: "Report a phone number as spam",
      description:
        "File a spam report for a phone number. This is a WRITE to shared " +
        "organization state and is submitted upstream to CallerAPI — check " +
        "callerapi_is_reported first, and only report numbers you have evidence " +
        "for (e.g. from call records or transcripts).",
      inputSchema: {
        phoneNumber: z.string(),
        subject: z.string().optional(),
        comment: z.string().optional(),
        consumerState: z.string().optional().describe("Two-letter US state code"),
        isRobocall: z.boolean().optional(),
        violationDate: z.string().optional().describe("ISO date of the offending call"),
        spamType: z.string().optional(),
        reason: z.string().optional(),
      },
    },
    safeHandler((body) => api.post("/callerapi/report-spam", body))
  );

  server.registerTool(
    "callerapi_update_spam_reason",
    {
      title: "Update the reason on an existing spam report",
      inputSchema: {
        phoneNumber: z.string(),
        reason: z.string(),
      },
    },
    safeHandler((body) => api.put("/callerapi/update-reason", body))
  );

  server.registerTool(
    "callerapi_delete_spam_report",
    {
      title: "Delete a spam report",
      description:
        "Remove a previously filed spam report for a number. Destructive — only " +
        "use when a report was filed in error.",
      inputSchema: { phoneNumber: z.string() },
    },
    safeHandler(({ phoneNumber }) =>
      api.request("/callerapi/delete-spam-report", {
        method: "DELETE",
        body: { phoneNumber },
      })
    )
  );

  server.registerTool(
    "callerapi_validate",
    {
      title: "Validate the configured CallerAPI credentials",
      description: "Non-destructive connectivity/credential check.",
      inputSchema: {},
    },
    safeHandler(() => api.get("/callerapi/validate"))
  );
}
