import { z } from "zod";
import { safeHandler } from "./_helpers.js";

// Bitrix CRM stores PHONE/EMAIL as arrays of {VALUE, VALUE_TYPE} objects.
// Plain-string values silently no-op on add/update. Normalize agent-friendly
// strings to the expected shape; arrays pass through.
function normalizeBitrixFields(fields) {
  if (!fields || typeof fields !== "object") return fields;
  const out = { ...fields };
  for (const key of ["PHONE", "EMAIL"]) {
    const v = out[key];
    if (typeof v === "string" && v.trim()) {
      out[key] = [{ VALUE: v.trim(), VALUE_TYPE: "WORK" }];
    }
  }
  return out;
}

const ownerTypeId = z
  .union([z.literal("3"), z.literal("4"), z.literal(3), z.literal(4)])
  .describe("Bitrix owner type id: 3=Contact, 4=Company")
  .transform((v) => String(v));

const direction = z
  .union([z.literal("1"), z.literal("2"), z.literal(1), z.literal(2)])
  .describe("Call direction: 1=inbound, 2=outbound")
  .transform((v) => String(v));

// Mirror the activity-timeline description the backend audit script builds
// (tools/3cx2bitrix-call-records-audit-script.js):
//   "{date} {time} {Status} {Direction} call from {from} to {to}\n\nTranscription: {…}"
// The backend create-call-activity route does NOT format anything — it stores
// callRecord.description verbatim + the attribution footer. So if an agent
// passes a thin string, the timeline entry is thin. This builds the canonical
// text from structured fields when the caller hasn't supplied a full one.
function buildCallDescription(callRecord) {
  // If the caller passed a real, formatted description (e.g. the audit record's
  // DESCRIPTION field verbatim), trust it. Heuristic: anything multi-line or
  // longer than a bare ID counts as "already formatted".
  const provided = (callRecord.description || "").trim();
  if (provided && (provided.includes("\n") || provided.length > 40)) {
    return provided;
  }

  const dir =
    String(callRecord.direction) === "1"
      ? "Inbound"
      : String(callRecord.direction) === "2"
        ? "Outbound"
        : "";
  const status = callRecord.status || "Answered";
  const from = callRecord.fromName || callRecord.phoneNumber || "Unknown";
  const to = callRecord.toName || "";
  let when = "";
  if (callRecord.startTime) {
    const d = new Date(callRecord.startTime);
    when = Number.isNaN(d.getTime())
      ? callRecord.startTime
      : `${d.toLocaleDateString("en-US")} ${d.toLocaleTimeString("en-US")}`;
  }

  const header = [when, status, dir, "call from", from, to ? `to ${to}` : ""]
    .filter(Boolean)
    .join(" ");
  return callRecord.transcription
    ? `${header}\n\nTranscription: ${callRecord.transcription}`
    : header;
}

export function registerBitrixTools(server, api) {
  server.registerTool(
    "bitrix_search_contacts",
    {
      title: "Search Bitrix contacts",
      description:
        "Search Bitrix24 contacts by free-text query, first name, or last name. Returns paginated results.",
      inputSchema: {
        query: z.string().optional().describe("Free-text search across name and phone"),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        bitrixStart: z.number().int().nonnegative().optional().describe("Pagination cursor"),
      },
    },
    safeHandler(({ query, firstName, lastName, bitrixStart }) =>
      api.get("/bitrix/search/contacts", {
        query: { query, firstName, lastName, bitrixStart },
      })
    )
  );

  server.registerTool(
    "bitrix_search_companies",
    {
      title: "Search Bitrix companies",
      description: "Search Bitrix24 companies by title.",
      inputSchema: {
        query: z.string().describe("Company title fragment"),
        bitrixStart: z.number().int().nonnegative().optional(),
      },
    },
    safeHandler(({ query, bitrixStart }) =>
      api.get("/bitrix/search/companies", { query: { query, bitrixStart } })
    )
  );

  server.registerTool(
    "bitrix_find_contact_by_phone",
    {
      title: "Find Bitrix contact by exact phone",
      description:
        "Look up a Bitrix24 contact by an exact phone number. Returns the contact or null.",
      inputSchema: {
        phone: z.string().describe("E.164 or raw phone number"),
      },
    },
    safeHandler(({ phone }) =>
      api.get(`/bitrix/search/contact-by-phone/${encodeURIComponent(phone)}`)
    )
  );

  server.registerTool(
    "bitrix_get_contact",
    {
      title: "Get Bitrix contact",
      description: "Fetch a Bitrix24 contact by id.",
      inputSchema: { id: z.union([z.string(), z.number()]) },
    },
    safeHandler(({ id }) => api.get(`/bitrix/contact/${id}`))
  );

  server.registerTool(
    "bitrix_get_company",
    {
      title: "Get Bitrix company",
      description: "Fetch a Bitrix24 company by id.",
      inputSchema: { id: z.union([z.string(), z.number()]) },
    },
    safeHandler(({ id }) => api.get(`/bitrix/company/${id}`))
  );

  server.registerTool(
    "bitrix_list_companies",
    {
      title: "List Bitrix companies",
      description: "Paginated list of Bitrix24 companies.",
      inputSchema: {
        page: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    safeHandler(({ page, limit }) =>
      api.get("/bitrix/companies", { query: { page, limit } })
    )
  );

  server.registerTool(
    "bitrix_get_activity",
    {
      title: "Get Bitrix activity",
      description: "Fetch a Bitrix24 activity (call/task) by id.",
      inputSchema: { id: z.union([z.string(), z.number()]) },
    },
    safeHandler(({ id }) => api.get(`/bitrix/activity/${id}`))
  );

  server.registerTool(
    "bitrix_create_contact",
    {
      title: "Create Bitrix contact",
      description: "Create a new Bitrix24 contact.",
      inputSchema: {
        NAME: z.string().optional(),
        LAST_NAME: z.string().optional(),
        PHONE: z.string().optional(),
        EMAIL: z.string().optional(),
        COMPANY_ID: z.union([z.string(), z.number()]).optional(),
        ADDRESS: z.string().optional(),
        ADDRESS_CITY: z.string().optional(),
        ADDRESS_POSTAL_CODE: z.string().optional(),
      },
    },
    safeHandler((fields) =>
      api.post("/bitrix/contact", { fields: normalizeBitrixFields(fields) })
    )
  );

  server.registerTool(
    "bitrix_update_contact",
    {
      title: "Update Bitrix contact",
      description: "Update fields on an existing Bitrix24 contact.",
      inputSchema: {
        id: z.union([z.string(), z.number()]),
        fields: z
          .record(z.any())
          .describe("Object of Bitrix contact fields to update"),
      },
    },
    safeHandler(({ id, fields }) =>
      api.put(`/bitrix/contact/${id}`, {
        fields: normalizeBitrixFields(fields),
      })
    )
  );

  server.registerTool(
    "bitrix_create_company",
    {
      title: "Create Bitrix company",
      description: "Create a new Bitrix24 company.",
      inputSchema: {
        TITLE: z.string(),
        PHONE: z.string().optional(),
        EMAIL: z.string().optional(),
        ADDRESS: z.string().optional(),
        ADDRESS_CITY: z.string().optional(),
        ADDRESS_POSTAL_CODE: z.string().optional(),
      },
    },
    safeHandler((fields) =>
      api.post("/bitrix/company", { fields: normalizeBitrixFields(fields) })
    )
  );

  server.registerTool(
    "bitrix_update_company",
    {
      title: "Update Bitrix company",
      description: "Update fields on a Bitrix24 company.",
      inputSchema: {
        id: z.union([z.string(), z.number()]),
        fields: z.record(z.any()),
      },
    },
    safeHandler(({ id, fields }) =>
      api.put(`/bitrix/company/${id}`, {
        fields: normalizeBitrixFields(fields),
      })
    )
  );

  server.registerTool(
    "bitrix_create_call_activity",
    {
      title: "Create Bitrix call activity (3CX import)",
      description:
        "Create a Bitrix24 call activity from a 3CX call record. The timeline " +
        "entry text is built from the fields below — you do NOT need to format " +
        "it yourself. IMPORTANT: when importing a record returned by " +
        "audit_data_for_job / audit_export_for_job, pass that record's full " +
        "DESCRIPTION string as `description` (it is already formatted). " +
        "Otherwise omit `description` and provide the structured fields " +
        "(direction, status, fromName, toName, transcription) and the server " +
        "will format a proper entry. Do NOT pass a bare id like '3CX ID 65144'. " +
        "Attribution and (for long text) a .txt attachment are added " +
        "server-side. Do NOT include PROVIDER_ID/PROVIDER_TYPE_ID.\n\n" +
        "For bulk audit imports prefer jobs_start_batch_missing_call_records, " +
        "which formats every record server-side.",
      inputSchema: {
        ownerId: z.union([z.string(), z.number()]),
        ownerTypeId,
        callRecord: z.object({
          phoneNumber: z.string(),
          startTime: z.string().describe("ISO 8601 timestamp"),
          direction: direction.optional(),
          status: z
            .string()
            .optional()
            .describe('Call status, e.g. "Answered" / "Unanswered" (default "Answered")'),
          fromName: z
            .string()
            .optional()
            .describe("Caller / source display name or number (SourceCallerId)"),
          toName: z
            .string()
            .optional()
            .describe("Destination display name (DestinationDisplayName)"),
          transcription: z.string().optional(),
          description: z
            .string()
            .optional()
            .describe(
              "Pre-formatted timeline text. Pass the audit record's DESCRIPTION verbatim here when you have it; otherwise leave empty and the server builds it from the structured fields."
            ),
          duration: z.number().optional(),
          srcRecId: z
            .union([z.string(), z.number()])
            .optional()
            .describe("3CX recording id — enables .wav attachment server-side"),
          settings: z.record(z.any()).optional(),
        }),
      },
    },
    safeHandler(({ ownerId, ownerTypeId, callRecord }) =>
      api.post("/bitrix/create-call-activity", {
        ownerId,
        ownerTypeId,
        callRecord: {
          ...callRecord,
          description: buildCallDescription(callRecord),
        },
      })
    )
  );

  server.registerTool(
    "bitrix_batch_create_activities",
    {
      title: "Batch create Bitrix activities",
      description:
        "Create multiple Bitrix24 activities in one request. Returns per-item " +
        "success/error. NOTE: this is a low-level passthrough — each activity's " +
        "DESCRIPTION is stored as-is (only attribution is appended server-side). " +
        "Each DESCRIPTION must be the full formatted call text " +
        "('{date} {status} {direction} call from {from} to {to}\\n\\nTranscription: …'), " +
        "not a bare id. For importing missing records from an audit, prefer " +
        "jobs_start_batch_missing_call_records — it formats every record " +
        "server-side and needs no per-record text from you.",
      inputSchema: {
        activities: z
          .array(z.record(z.any()))
          .describe(
            "Array of Bitrix activity field objects. Each should include a fully-formatted DESCRIPTION."
          ),
      },
    },
    safeHandler(({ activities }) =>
      api.post("/bitrix/batch-create-activities", { activities })
    )
  );

  server.registerTool(
    "bitrix_update_activity",
    {
      title: "Update Bitrix activity",
      description: "Update fields on a Bitrix24 activity.",
      inputSchema: {
        id: z.union([z.string(), z.number()]),
        fields: z.record(z.any()),
      },
    },
    safeHandler(({ id, fields }) =>
      api.put(`/bitrix/activity/${id}`, { fields })
    )
  );

  server.registerTool(
    "bitrix_add_transcript",
    {
      title: "Add transcript to Bitrix activity",
      description: "Append a 3CX transcript to an existing Bitrix activity.",
      inputSchema: {
        activityId: z.union([z.string(), z.number()]),
        transcription: z.string(),
      },
    },
    safeHandler((body) => api.post("/bitrix/add-transcript", body))
  );

  server.registerTool(
    "bitrix_enrich_record",
    {
      title: "Enrich Bitrix contact with 3CX call data",
      description:
        "Attach a list of 3CX call records to a Bitrix contact, generating activities as needed.",
      inputSchema: {
        contactId: z.union([z.string(), z.number()]),
        callRecords: z.array(z.record(z.any())),
      },
    },
    safeHandler((body) => api.post("/bitrix/enrich-record", body))
  );

  server.registerTool(
    "bitrix_batch_enrich_records",
    {
      title: "Batch enrich Bitrix contacts",
      description: "Run enrichment for multiple contact+call payloads.",
      inputSchema: {
        records: z.array(z.record(z.any())),
      },
    },
    safeHandler((body) => api.post("/bitrix/batch-enrich-records", body))
  );

  server.registerTool(
    "bitrix_send_contact_from_3cx",
    {
      title: "Create contact/company from 3CX record",
      description:
        "High-level: optionally create a contact and/or company from a 3CX call " +
        "record, then log the call on its timeline. Mirrors the UI 'Send to " +
        "Bitrix' flow. The activity DESCRIPTION is taken from " +
        "`contactRecord.DESCRIPTION` as-is (attribution appended server-side), " +
        "so pass the audit record's full formatted DESCRIPTION there — not a " +
        "bare id.",
      inputSchema: {
        createContact: z.boolean().optional(),
        createCompany: z.boolean().optional(),
        contactRecord: z
          .record(z.any())
          .describe(
            "3CX record fields. Include a fully-formatted DESCRIPTION (and PHONE_NUMBER, START_TIME) so the logged activity isn't thin."
          ),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().optional(),
        companyId: z.union([z.string(), z.number()]).optional(),
        newCompanyTitle: z.string().optional(),
      },
    },
    safeHandler((body) => api.post("/bitrix/send-contact", body))
  );

  server.registerTool(
    "bitrix_batch_enrich_transcripts",
    {
      title: "Batch add transcripts to Bitrix activities",
      description:
        "Attach transcripts to many existing Bitrix activities in one call. " +
        "Each record identifies the target activity and the transcript text.",
      inputSchema: {
        records: z
          .array(z.record(z.any()))
          .describe("Records carrying activity ids and transcript text"),
      },
    },
    safeHandler(({ records }) => api.post("/bitrix/batch-enrich-transcripts", { records }))
  );

  server.registerTool(
    "bitrix_remove_processed_record",
    {
      title: "Mark audit records as processed",
      description:
        "Remove already-imported records from an audit report's outstanding list so " +
        "they stop showing as missing. Pass the `_metadata` of the records you " +
        "imported (chunkDocId / arrayIndex), from audit_data_for_job.",
      inputSchema: {
        auditJobId: z.string(),
        recordMetadata: z
          .array(z.record(z.any()))
          .describe("Array of _metadata objects for the processed records"),
      },
    },
    safeHandler((body) => api.post("/bitrix/remove-processed-record", body))
  );

  server.registerTool(
    "bitrix_remove_processed_transcript",
    {
      title: "Mark transcript records as processed",
      description:
        "Remove activities whose transcripts have been imported from an audit " +
        "report's outstanding transcript list.",
      inputSchema: {
        auditJobId: z.string(),
        activityIds: z.array(z.union([z.string(), z.number()])),
      },
    },
    safeHandler((body) => api.post("/bitrix/remove-processed-transcript", body))
  );

  server.registerTool(
    "bitrix_create_activity_raw",
    {
      title: "Create a Bitrix activity from raw fields",
      description:
        "Low-level escape hatch: creates an activity from a raw Bitrix fields " +
        "object. Prefer bitrix_create_call_activity for 3CX call imports — it " +
        "formats the timeline entry, adds attribution and handles attachments. " +
        "Do NOT set PROVIDER_ID / PROVIDER_TYPE_ID; the defaults are correct.",
      inputSchema: {
        fields: z.record(z.any()).describe("Raw Bitrix activity fields"),
      },
    },
    safeHandler(({ fields }) => api.post("/bitrix/activity", { fields }))
  );

  server.registerTool(
    "bitrix_merge_phone",
    {
      title: "Merge phone numbers",
      description:
        "Replace an old phone number with a new one across Bitrix24 contact/company records.",
      inputSchema: {
        ownerId: z.union([z.string(), z.number()]),
        ownerTypeId,
        oldPhone: z.string(),
        newPhone: z.string(),
      },
    },
    safeHandler((body) => api.post("/bitrix/merge-phone", body))
  );
}
