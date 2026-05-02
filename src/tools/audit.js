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
        "Aggregated summary across all audit reports overlapping the given date range. Numbers are summed; daily-volume buckets are merged. Implemented client-side: fetches recent reports and aggregates locally — the backend's range endpoint is broken at the moment.",
      inputSchema: {
        startDate: z.string().describe("ISO date (yyyy-mm-dd or full ISO)"),
        endDate: z.string().describe("ISO date (yyyy-mm-dd or full ISO)"),
      },
    },
    safeHandler(async ({ startDate, endDate }) => {
      const reports = await api.get("/call-records-audit/reports", {
        query: { limit: 100 },
      });
      const matched = filterReportsByRange(reports, startDate, endDate);

      const summary = {
        totalCalls: 0,
        foundCalls: 0,
        missingCalls: 0,
        totalContacts: 0,
        foundContacts: 0,
        missingContacts: 0,
        totalTranscripts: 0,
        foundTranscripts: 0,
        missingTranscripts: 0,
        reportCount: matched.length,
      };
      const daily = new Map();
      for (const r of matched) {
        for (const k of Object.keys(summary)) {
          if (k === "reportCount") continue;
          summary[k] += Number(r[k]) || 0;
        }
        for (const entry of r.dailyCalls || []) {
          // Each entry is { "2026-04-01": { found, missing, total } }
          for (const [date, v] of Object.entries(entry)) {
            const acc = daily.get(date) || { found: 0, missing: 0, total: 0 };
            acc.found += Number(v.found) || 0;
            acc.missing += Number(v.missing) || 0;
            acc.total += Number(v.total) || 0;
            daily.set(date, acc);
          }
        }
      }
      summary.matchRate =
        summary.totalCalls > 0
          ? (summary.foundCalls / summary.totalCalls) * 100
          : 0;

      return {
        dateRange: { startDate, endDate },
        summary,
        matchedReportIds: matched.map((r) => r.id),
        charts: {
          dailyVolume: [...daily.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, v]) => ({ date, ...v })),
          matchDistribution: [
            { label: "Matched", value: summary.foundCalls },
            { label: "Missing", value: summary.missingCalls },
          ],
        },
      };
    })
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
      description:
        "Find reports overlapping the date range and return a list of their job ids + summary counts. To pull the raw missing-record rows, follow up with `audit_export_for_job` for each id (avoids one giant payload that would blow MCP token limits).",
      inputSchema: {
        startDate: z.string(),
        endDate: z.string(),
      },
    },
    safeHandler(async ({ startDate, endDate }) => {
      const reports = await api.get("/call-records-audit/reports", {
        query: { limit: 100 },
      });
      const matched = filterReportsByRange(reports, startDate, endDate);
      return {
        dateRange: { startDate, endDate },
        reportCount: matched.length,
        reports: matched.map((r) => ({
          reportId: r.id,
          jobId: r.jobId,
          startDate: r.startDate,
          endDate: r.endDate,
          totalCalls: r.totalCalls,
          missingCalls: r.missingCalls,
          missingContacts: r.missingContacts,
          missingTranscripts: r.missingTranscripts,
        })),
        nextStep:
          "Call audit_export_for_job(jobId, format='csv'|'json') for each entry above to fetch the full missing-records export.",
      };
    })
  );
}

function filterReportsByRange(reports, startDate, endDate) {
  // Return reports whose [startDate, endDate] window overlaps the requested
  // range. Works on ISO strings (lexicographically ordered) regardless of
  // whether the stored values are 'yyyy-mm-dd' or full timestamps.
  const lo = startDate;
  const hi = endDate;
  return reports.filter((r) => {
    if (!r.startDate || !r.endDate) return false;
    return r.startDate <= hi && r.endDate >= lo;
  });
}
