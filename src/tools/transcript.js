import { z } from "zod";
import { safeHandler } from "./_helpers.js";

export function registerTranscriptTools(server, api) {
  server.registerTool(
    "transcript_check_cache",
    {
      title: "Check advanced transcript cache",
      description:
        "Check if a filename has cached advanced-transcript artifacts (diarized transcript, summary, sentiment, action plan, coaching).",
      inputSchema: { filename: z.string() },
    },
    safeHandler(({ filename }) =>
      api.get(`/advanced-transcript/check-cache/${encodeURIComponent(filename)}`)
    )
  );

  server.registerTool(
    "transcript_check_cache_batch",
    {
      title: "Batch-check advanced transcript cache",
      description: "Check up to 100 filenames at once.",
      inputSchema: {
        filenames: z.array(z.string()).max(100),
      },
    },
    safeHandler(({ filenames }) =>
      api.post("/advanced-transcript/check-cache-batch", { filenames })
    )
  );
}
