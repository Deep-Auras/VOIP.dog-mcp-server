import { z } from "zod";
import { safeHandler } from "./_helpers.js";

// Every advanced-transcript record is keyed by the recording's .wav filename,
// but agents (and humans) work in 3CX recording IDs. Resolve one to the other
// so callers never have to do the lookup themselves.
//
// The backend's /3cx/recordings endpoint forwards `q` to 3CX's OData $search,
// which matches the recording ID, so a search for "66968" returns exactly that
// recording. `recordingUrl` comes back prefixed with the extension folder
// (e.g. "13/[Zimbler, Larry]_13-59_...wav") — the stored key is only the last
// path segment.
async function resolveFilename(api, { filename, recordingId, from, to }) {
  if (filename) return { filename, resolvedFrom: "filename" };

  if (recordingId === undefined || recordingId === null) {
    throw new Error("Provide either `recordingId` or `filename`.");
  }

  const id = String(recordingId).trim();
  const query = { q: id, top: 25 };
  // Narrow when the caller knows roughly when the call happened; otherwise
  // search wide, since the backend defaults to only the last 30 days.
  query.from = from || "2020-01-01";
  query.to = to || new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const result = await api.get("/3cx/recordings", { query });
  const items = result?.items || [];
  const match = items.find((r) => String(r.id) === id);

  if (!match) {
    throw new Error(
      `No 3CX recording found with id ${id}` +
        (from || to ? ` in ${query.from}..${query.to}` : "") +
        `. Check the id, or pass \`from\`/\`to\` to widen the search.`
    );
  }
  if (!match.recordingUrl) {
    throw new Error(`Recording ${id} has no recordingUrl — nothing was recorded for this call.`);
  }

  const segment = match.recordingUrl.split("/").filter(Boolean).pop();
  return {
    filename: segment,
    resolvedFrom: "recordingId",
    recording: {
      id: match.id,
      startTime: match.startTime,
      durationSeconds: match.duration,
      from: match.fromDisplayName || match.fromNumber,
      to: match.toDisplayName || match.toNumber,
    },
  };
}

// The diarized transcript dominates the payload — a 2.5 hour call is ~112k
// characters, which alone will blow most agents' tool-result budget. Omit it
// unless asked for, so the analysis is usable by default.
const ANALYSIS_FIELDS = [
  "transcriptSummary",
  "sentimentAnalysis",
  "actionPlan",
  "coaching",
  "metadata",
];

function shapeResult(payload, { includeTranscript }) {
  if (!payload?.cached) return payload;
  const data = payload.data || {};
  const out = {};
  for (const key of ANALYSIS_FIELDS) {
    if (data[key] !== undefined) out[key] = data[key];
  }

  const transcript = data.diarizedTranscript || data.advancedTranscript || "";
  if (includeTranscript) {
    out.diarizedTranscript = transcript;
  } else if (transcript) {
    out.diarizedTranscriptOmitted = {
      characters: transcript.length,
      note: "Full transcript omitted to keep the response small. Re-run with includeTranscript: true to fetch it.",
    };
  }
  return { cached: true, data: out };
}

export function registerTranscriptTools(server, api) {
  server.registerTool(
    "transcript_check_cache",
    {
      title: "Get advanced transcription for a recording",
      description:
        "Fetch the stored advanced-transcription result for a 3CX call: summary, " +
        "sentiment, action plan, coaching, and (on request) the full diarized " +
        "transcript.\n\n" +
        "Identify the call by `recordingId` (e.g. 66968) — the filename lookup is " +
        "done for you — or pass `filename` directly if you already have it.\n\n" +
        "`cached: false` means this recording has never been successfully " +
        "processed, NOT that it is still being generated. Producing one requires " +
        "a 3cx-crat job, which re-runs paid speech-to-text over the whole " +
        "recording.\n\n" +
        "The diarized transcript is omitted by default because it is very large " +
        "(a 2.5 hour call is ~112,000 characters); set includeTranscript: true " +
        "only when you actually need the verbatim text.",
      inputSchema: {
        recordingId: z
          .union([z.string(), z.number()])
          .optional()
          .describe("3CX recording id, e.g. 66968. Preferred over filename."),
        filename: z
          .string()
          .optional()
          .describe("Recording .wav filename, if already known."),
        from: z
          .string()
          .optional()
          .describe("ISO date lower bound to narrow the recordingId lookup."),
        to: z
          .string()
          .optional()
          .describe("ISO date upper bound to narrow the recordingId lookup."),
        includeTranscript: z
          .boolean()
          .optional()
          .describe("Include the full diarized transcript (large). Default false."),
      },
    },
    safeHandler(async ({ recordingId, filename, from, to, includeTranscript = false }) => {
      const resolved = await resolveFilename(api, { filename, recordingId, from, to });
      const payload = await api.get(
        `/advanced-transcript/check-cache/${encodeURIComponent(resolved.filename)}`
      );
      const shaped = shapeResult(payload, { includeTranscript });
      return {
        ...shaped,
        filename: resolved.filename,
        ...(resolved.recording ? { recording: resolved.recording } : {}),
      };
    })
  );

  server.registerTool(
    "transcript_check_cache_batch",
    {
      title: "Batch-check advanced transcriptions",
      description:
        "Check up to 100 recordings at once for stored advanced transcriptions. " +
        "Accepts recording ids or filenames. Returns only whether each has a " +
        "result — use transcript_check_cache for the contents of a single one.",
      inputSchema: {
        recordingIds: z
          .array(z.union([z.string(), z.number()]))
          .max(100)
          .optional()
          .describe("3CX recording ids. Resolved to filenames automatically."),
        filenames: z
          .array(z.string())
          .max(100)
          .optional()
          .describe("Recording .wav filenames, if already known."),
        from: z.string().optional(),
        to: z.string().optional(),
      },
    },
    safeHandler(async ({ recordingIds, filenames, from, to }) => {
      let names = filenames || [];
      const failures = [];

      if (recordingIds?.length) {
        // Resolve sequentially: each lookup is a 3CX query and the backend is
        // rate-sensitive on wide date ranges.
        for (const id of recordingIds) {
          try {
            const r = await resolveFilename(api, { recordingId: id, from, to });
            names.push(r.filename);
          } catch (err) {
            failures.push({ recordingId: id, error: err.message });
          }
        }
      }

      if (names.length === 0) {
        throw new Error("Provide `recordingIds` or `filenames` (at least one resolvable).");
      }

      const result = await api.post("/advanced-transcript/check-cache-batch", {
        filenames: names,
      });
      return failures.length ? { ...result, unresolved: failures } : result;
    })
  );
}
