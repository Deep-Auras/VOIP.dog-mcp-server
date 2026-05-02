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
        "Create a Bitrix24 call activity from a 3CX call record. Server-side handles attribution and (when description >500 chars) automatic .txt attachment. Do NOT include PROVIDER_ID/PROVIDER_TYPE_ID — defaults are correct.",
      inputSchema: {
        ownerId: z.union([z.string(), z.number()]),
        ownerTypeId,
        callRecord: z.object({
          phoneNumber: z.string(),
          startTime: z.string().describe("ISO 8601 timestamp"),
          direction: direction.optional(),
          description: z.string().optional(),
          transcription: z.string().optional(),
          duration: z.number().optional(),
          settings: z.record(z.any()).optional(),
        }),
      },
    },
    safeHandler((body) => api.post("/bitrix/create-call-activity", body))
  );

  server.registerTool(
    "bitrix_batch_create_activities",
    {
      title: "Batch create Bitrix activities",
      description:
        "Create multiple Bitrix24 activities in one request. Returns per-item success/error.",
      inputSchema: {
        activities: z
          .array(z.record(z.any()))
          .describe("Array of activity payloads"),
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
        "High-level: optionally create a contact and/or company from a 3CX call record. Mirrors the UI 'Send to Bitrix' flow.",
      inputSchema: {
        createContact: z.boolean().optional(),
        createCompany: z.boolean().optional(),
        contactRecord: z.record(z.any()),
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
