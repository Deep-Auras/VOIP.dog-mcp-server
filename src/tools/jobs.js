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
    "jobs_start_advanced_transcription",
    {
      title: "Start advanced transcription (3cx-crat) for a recording",
      description:
        "Run the 3cx-crat job: speech-to-text with speaker diarization, then " +
        "Gemini analysis (summary, sentiment, action plan, coaching). This is " +
        "the ONLY way to produce what transcript_check_cache reads.\n\n" +
        "Identify the call by `recordingId` alone — duration, URL and start " +
        "time are looked up for you.\n\n" +
        "COST: this pays for speech-to-text across the entire recording. A " +
        "2.5-hour call costs roughly $2-3 and takes many minutes. By default " +
        "this tool refuses to start if a result already exists (use " +
        "`force: true` to re-run anyway) and refuses recordings longer than " +
        "`maxDurationHours`. Do not retry a failed job without reading its " +
        "logs first — repeated runs repeat the charge.",
      inputSchema: {
        recordingId: z.union([z.string(), z.number()]).describe("3CX recording id, e.g. 66968"),
        from: z.string().optional().describe("ISO date lower bound to narrow the lookup"),
        to: z.string().optional().describe("ISO date upper bound to narrow the lookup"),
        force: z
          .boolean()
          .optional()
          .describe("Re-run even if a transcription already exists. Default false."),
        maxDurationHours: z
          .number()
          .optional()
          .describe("Refuse recordings longer than this. Default 4."),
      },
    },
    safeHandler(async ({ recordingId, from, to, force = false, maxDurationHours = 4 }) => {
      const id = String(recordingId).trim();

      // Resolve the recording — the job needs duration, URL and start time.
      const search = await api.get("/3cx/recordings", {
        query: {
          q: id,
          top: 25,
          from: from || "2020-01-01",
          to: to || new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        },
      });
      const rec = (search?.items || []).find((r) => String(r.id) === id);
      if (!rec) {
        throw new Error(
          `No 3CX recording found with id ${id}. Check the id, or pass from/to to widen the search.`
        );
      }
      if (!rec.recordingUrl) {
        throw new Error(`Recording ${id} has no recordingUrl — there is no audio to transcribe.`);
      }

      const durationSeconds = Number(rec.duration) || 0;
      const durationHours = durationSeconds / 3600;

      // Guard 1: don't pay twice for a result we already have.
      if (!force) {
        const filename = rec.recordingUrl.split("/").filter(Boolean).pop();
        const existing = await api
          .get(`/advanced-transcript/check-cache/${encodeURIComponent(filename)}`)
          .catch(() => null);
        if (existing?.cached) {
          return {
            started: false,
            reason: "already_transcribed",
            recordingId: id,
            filename,
            message:
              "An advanced transcription already exists for this recording. " +
              "Read it with transcript_check_cache, or pass force: true to re-run " +
              "(which repeats the speech-to-text charge).",
          };
        }
      }

      // Guard 2: bound the spend on pathologically long recordings.
      if (durationHours > maxDurationHours) {
        throw new Error(
          `Recording ${id} is ${durationHours.toFixed(2)} hours, over the ${maxDurationHours} hour limit. ` +
            `Transcribing it would be expensive. Raise maxDurationHours only if that cost is intended.`
        );
      }

      const job = await api.post("/jobs", {
        type: "3cx-crat",
        parameters: {
          recId: id,
          recDuration: durationSeconds,
          recordingURL: rec.recordingUrl,
          recStartTime: rec.startTime,
        },
      });

      return {
        started: true,
        job,
        recording: {
          id: rec.id,
          startTime: rec.startTime,
          durationSeconds,
          durationHours: Number(durationHours.toFixed(2)),
          from: rec.fromDisplayName || rec.fromNumber,
          to: rec.toDisplayName || rec.toNumber,
        },
        nextStep:
          "Poll with jobs_wait_for_completion, then read the result with " +
          "transcript_check_cache using the same recordingId.",
      };
    })
  );

  server.registerTool(
    "jobs_start_recurring_invoice_import",
    {
      title: "Start recurring-invoice import (Bitrix)",
      description:
        "Run the recurring-invoices job: converts Bitrix24 recurring invoices into " +
        "deals. Takes no parameters and writes to Bitrix in bulk — only run when " +
        "explicitly asked.",
      inputSchema: {},
    },
    safeHandler(() => api.post("/jobs", { type: "recurring-invoices", parameters: {} }))
  );

  server.registerTool(
    "jobs_start_pending",
    {
      title: "Start a job that is pending",
      description:
        "Begin execution of a job currently in 'pending' state (e.g. one created " +
        "but not auto-started). Use jobs_get first to confirm the status.",
      inputSchema: { id: z.string() },
    },
    safeHandler(({ id }) => api.post(`/jobs/${id}/start`))
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
