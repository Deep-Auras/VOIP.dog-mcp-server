import { z } from "zod";
import { safeHandler } from "./_helpers.js";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function registerJobsTools(server, api) {
  server.registerTool(
    "jobs_list_types",
    {
      title: "List available background job types",
      description:
        "Catalogue of job types and parameter schemas (3cx-audit, batch-missing-call-records, batch-missing-transcripts, contact-activity-search, 3cx-crat, recurring-invoices).",
      inputSchema: {},
    },
    safeHandler(() => api.get("/jobs/types"))
  );

  server.registerTool(
    "jobs_list",
    {
      title: "List jobs",
      description: "List jobs for the user's organization, filtered by status.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
        status: z
          .enum(["pending", "running", "completed", "failed", "cancelled"])
          .optional(),
      },
    },
    safeHandler((args) => api.get("/jobs", { query: args }))
  );

  server.registerTool(
    "jobs_get",
    {
      title: "Get job",
      inputSchema: { id: z.string() },
    },
    safeHandler(({ id }) => api.get(`/jobs/${id}`))
  );

  server.registerTool(
    "jobs_get_logs",
    {
      title: "Get job logs",
      inputSchema: { id: z.string() },
    },
    safeHandler(({ id }) => api.get(`/jobs/${id}/logs`))
  );

  server.registerTool(
    "jobs_start_3cx_audit",
    {
      title: "Start 3CX call-records audit job",
      description:
        "Run an audit comparing 3CX recordings against Bitrix24 activities for a date range.",
      inputSchema: {
        startDate: z.string().describe("ISO date or yyyy-mm-dd"),
        endDate: z.string().describe("ISO date or yyyy-mm-dd"),
      },
    },
    safeHandler((parameters) =>
      api.post("/jobs", { type: "3cx-audit", parameters })
    )
  );

  server.registerTool(
    "jobs_start_batch_missing_call_records",
    {
      title: "Start batch: import missing call records",
      description:
        "After running an audit, batch-create Bitrix activities for selected missing call records.",
      inputSchema: {
        auditJobId: z.string(),
        selectedRecordIds: z
          .array(z.string())
          .describe("Record ids to process (will be CSV-joined server-side)"),
      },
    },
    safeHandler(({ auditJobId, selectedRecordIds }) =>
      api.post("/jobs", {
        type: "batch-missing-call-records",
        parameters: {
          auditJobId,
          selectedRecordIds: Array.isArray(selectedRecordIds)
            ? selectedRecordIds.join(",")
            : selectedRecordIds,
        },
      })
    )
  );

  server.registerTool(
    "jobs_start_batch_missing_transcripts",
    {
      title: "Start batch: backfill missing transcripts",
      inputSchema: {
        auditJobId: z.string(),
        selectedRecordIds: z.array(z.string()),
      },
    },
    safeHandler(({ auditJobId, selectedRecordIds }) =>
      api.post("/jobs", {
        type: "batch-missing-transcripts",
        parameters: {
          auditJobId,
          selectedRecordIds: Array.isArray(selectedRecordIds)
            ? selectedRecordIds.join(",")
            : selectedRecordIds,
        },
      })
    )
  );

  server.registerTool(
    "jobs_start_contact_activity_search",
    {
      title: "Start contact-activity search job",
      description:
        "Search Bitrix activities for a phone number, optionally tied to a created entity.",
      inputSchema: {
        phoneNumber: z.string(),
        createdEntityType: z.string().optional(),
        createdEntityId: z.union([z.string(), z.number()]).optional(),
        createdEntityName: z.string().optional(),
        auditJobId: z.string().optional(),
      },
    },
    safeHandler((parameters) =>
      api.post("/jobs", { type: "contact-activity-search", parameters })
    )
  );

  server.registerTool(
    "jobs_cancel",
    {
      title: "Cancel a running job",
      inputSchema: { id: z.string() },
    },
    safeHandler(({ id }) => api.post(`/jobs/${id}/cancel`))
  );

  server.registerTool(
    "jobs_delete",
    {
      title: "Delete a job",
      description:
        "Remove a job record. If the job is still running it will be cancelled first.",
      inputSchema: { id: z.string() },
    },
    safeHandler(({ id }) => api.del(`/jobs/${id}`))
  );

  server.registerTool(
    "jobs_wait_for_completion",
    {
      title: "Poll job until terminal",
      description:
        "Poll the job until it reaches a terminal status (completed, failed, cancelled) or the timeout expires. Returns the final job snapshot.",
      inputSchema: {
        id: z.string(),
        pollIntervalMs: z
          .number()
          .int()
          .min(500)
          .max(30000)
          .default(3000)
          .optional(),
        timeoutMs: z
          .number()
          .int()
          .min(1000)
          .max(30 * 60 * 1000)
          .default(10 * 60 * 1000)
          .optional(),
      },
    },
    safeHandler(async ({ id, pollIntervalMs = 3000, timeoutMs = 600000 }) => {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        last = await api.get(`/jobs/${id}`);
        const status = last?.status || last?.job?.status;
        if (status && TERMINAL_STATUSES.has(status)) return last;
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
      return {
        timedOut: true,
        elapsedMs: timeoutMs,
        lastSnapshot: last,
      };
    })
  );
}
