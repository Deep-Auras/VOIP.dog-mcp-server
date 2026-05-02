import { z } from "zod";
import { safeHandler } from "./_helpers.js";

export function registerAuditTools(server, api) {
  server.registerTool(
    "audit_list_reports",
    {
      title: "List call-records audit reports",
      description:
        "List historical audit reports for the user's organization, filtered by date range.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
        startDate: z.string().optional().describe("ISO date"),
        endDate: z.string().optional().describe("ISO date"),
      },
    },
    safeHandler((args) =>
      api.get("/call-records-audit/reports", { query: args })
    )
  );

  server.registerTool(
    "audit_get_report",
    {
      title: "Get audit report by id",
      inputSchema: { id: z.string() },
    },
    safeHandler(({ id }) => api.get(`/call-records-audit/reports/${id}`))
  );

  server.registerTool(
    "audit_summary",
    {
      title: "Audit summary stats",
      description:
        "Aggregate stats: total reports, total calls audited, average match rate, last audit date.",
      inputSchema: {},
    },
    safeHandler(() => api.get("/call-records-audit/summary"))
  );

  server.registerTool(
    "audit_dashboard_for_range",
    {
      title: "Audit dashboard for date range",
      description:
        "Aggregated dashboard data: daily volume, match distribution, hourly distribution, missing contacts.",
      inputSchema: {
        startDate: z.string().describe("ISO date (required)"),
        endDate: z.string().describe("ISO date (required)"),
      },
    },
    safeHandler((args) =>
      api.get("/call-records-audit/dashboard", { query: args })
    )
  );

  server.registerTool(
    "audit_dashboard_for_report",
    {
      title: "Audit dashboard for a specific report",
      inputSchema: { reportId: z.string() },
    },
    safeHandler(({ reportId }) =>
      api.get(`/call-records-audit/dashboard-data/${reportId}`)
    )
  );

  server.registerTool(
    "audit_data_for_job",
    {
      title: "Audit data for a completed job",
      description:
        "Returns dashboard-format data (hourly distribution, missing records, job details) for a completed audit job.",
      inputSchema: { jobId: z.string() },
    },
    safeHandler(({ jobId }) => api.get(`/call-records-audit/job/${jobId}`))
  );

  server.registerTool(
    "audit_export_for_job",
    {
      title: "Export audit data for a job",
      description: "Export missing-contacts data for a job as CSV or JSON.",
      inputSchema: {
        jobId: z.string(),
        format: z.enum(["csv", "json"]).default("json"),
      },
    },
    safeHandler(({ jobId, format }) =>
      api.get(`/call-records-audit/job/${jobId}/export`, {
        query: { format },
        accept: format === "csv" ? "text/csv" : "application/json",
      })
    )
  );

  server.registerTool(
    "audit_export_for_range",
    {
      title: "Export audit data for date range",
      inputSchema: {
        startDate: z.string(),
        endDate: z.string(),
        format: z.enum(["csv", "json"]).default("json"),
      },
    },
    safeHandler(({ startDate, endDate, format }) =>
      api.get("/call-records-audit/export", {
        query: { startDate, endDate, format },
        accept: format === "csv" ? "text/csv" : "application/json",
      })
    )
  );
}
