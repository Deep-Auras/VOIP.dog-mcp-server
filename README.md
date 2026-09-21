# VOIP.dog MCP Server

An MCP (Model Context Protocol) server that exposes the VOIP.dog backend
(Bitrix24 CRM operations, 3CX call recordings, audit reports, and background
jobs) to LLM agents — Claude Code, Gemini CLI, OpenAI, or any other
MCP-compatible client.

The agent calls strongly-typed tools instead of raw HTTP. All operations are
scoped to the authenticated user's organization, so an agent automatically
inherits the same data permissions the user has in the web app.

---

## Quick start

```bash
npx voipdog-mcp install
```

This single command:
1. Opens your browser to **Settings → API Tokens** so you can generate a token
2. Prompts you to paste it (input is masked)
3. Verifies the token works
4. Detects your MCP hosts (Claude Code, Claude Desktop, Cursor, Gemini CLI)
   and writes the `voipdog` server entry into each one you select

Restart your MCP host and you're done.

> Until the package is published to npm, run it from a checkout:
> ```bash
> cd VOIP.dog-mcp-server && npm install && node src/index.js install
> ```

### Manual install (any host the installer doesn't detect)

The installer drops this entry into your host config; if you'd rather edit by
hand, that's all you need:

```json
{
  "mcpServers": {
    "voipdog": {
      "command": "node",
      "args": ["/absolute/path/to/VOIP.dog-mcp-server/src/index.js"],
      "env": {
        "VOIPDOG_API_BASE_URL": "https://api.voip.dog/api",
        "VOIPDOG_SESSION_TOKEN": "voipdog_pat_..."
      }
    }
  }
}
```

| Host | Config path |
|---|---|
| Claude Code (CLI) | `~/.claude.json` |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` |
| Gemini CLI | `~/.gemini/settings.json` |

### Remote / self-hosted (Streamable HTTP)

For OpenAI Agents SDK or any remote consumer, run the server with `--http`:

```bash
node src/index.js --http
# → http://127.0.0.1:8765/mcp
```

`MCP_HTTP_HOST` and `MCP_HTTP_PORT` override the bind. The HTTP transport is
not authenticated by itself — put it behind your own auth proxy if you expose
it publicly.

---

## Authentication

The MCP server reads credentials from environment variables only:

- `VOIPDOG_API_BASE_URL` (required)
- `VOIPDOG_SESSION_TOKEN` — a Personal Access Token (recommended)
- *or* `VOIPDOG_EMAIL` + `VOIPDOG_PASSWORD` — only for `provider="email"`
  accounts; SSO accounts must use a PAT

The installer writes these into your MCP host's config. Hosts then inject them
into the server's environment when they spawn it.

PATs are generated from **Settings → API Tokens** in the web
app. They start with `voipdog_pat_`, are stored hashed in the backend, and can
be revoked at any time from the same panel.

---

## Transports

| Mode | Use when | How |
|---|---|---|
| **stdio** (default) | Local agents (Claude Code, Gemini CLI, Cursor) | `node src/index.js` |
| **streamable HTTP** | Remote agents, OpenAI Agents SDK, custom services | `node src/index.js --http` |

HTTP defaults to `127.0.0.1:8765`. Override with `MCP_HTTP_HOST` /
`MCP_HTTP_PORT`. The HTTP endpoint is **not** itself authenticated — it's
designed to be exposed only to a single trusted local agent. If you need to
expose it remotely, put it behind your own auth proxy.

---

## Tool catalog

All tools return JSON. Errors include the upstream HTTP status and body so the
agent can self-correct.

### Bitrix24 (`bitrix_*`)
- `bitrix_search_contacts` — name / phone search
- `bitrix_search_companies` — title search
- `bitrix_find_contact_by_phone` — exact phone lookup
- `bitrix_get_contact`, `bitrix_get_company`, `bitrix_get_activity`
- `bitrix_list_companies` — paginated list
- `bitrix_create_contact`, `bitrix_update_contact`
- `bitrix_create_company`, `bitrix_update_company`
- `bitrix_create_call_activity` — 3CX → Bitrix call import (handles defaults; do not pass PROVIDER_ID)
- `bitrix_batch_create_activities` — many at once
- `bitrix_update_activity`, `bitrix_add_transcript`
- `bitrix_enrich_record`, `bitrix_batch_enrich_records`
- `bitrix_send_contact_from_3cx` — high-level "Send to Bitrix" flow
- `bitrix_merge_phone`

### 3CX (`threecx_*`)
- `threecx_list_recordings` — date range, free-text query, paging
- `threecx_get_recording_url` — returns an authenticated URL (binary not piped through MCP)

### Call-records audit (`audit_*`)
- `audit_list_reports`, `audit_get_report`, `audit_summary`
- `audit_dashboard_for_range` — daily volume, hourly distribution, missing contacts
- `audit_dashboard_for_report`, `audit_data_for_job`
- `audit_export_for_job`, `audit_export_for_range` — CSV or JSON

### CallerAPI — phone reputation & spam (`callerapi_*`)
- `callerapi_spam_score`, `callerapi_is_reported`, `callerapi_list_reported_numbers`
- `callerapi_report_spam`, `callerapi_update_spam_reason`, `callerapi_delete_spam_report`
- `callerapi_enrich_record`, `callerapi_validate`

### Gemini (`gemini_*`)
- `gemini_extract_contact` — pull structured contact fields out of a call description
- `gemini_test`

### Background jobs (`jobs_*`)
- `jobs_list_types`, `jobs_list`, `jobs_get`, `jobs_get_logs`
- `jobs_start_3cx_audit` — kicks off a date-range audit
- `jobs_start_batch_missing_call_records` — import missing 3CX activities
- `jobs_start_batch_missing_transcripts` — backfill transcripts
- `jobs_start_contact_activity_search`
- `jobs_start_advanced_transcription` — **runs the 3cx-crat engine** that produces advanced transcriptions. Takes a `recordingId`; refuses if a result already exists or the call exceeds `maxDurationHours` (paid speech-to-text).
- `jobs_start_recurring_invoice_import`
- `jobs_start_pending` — begin a job left in `pending`
- `jobs_cancel`, `jobs_delete`
- `jobs_wait_for_completion` — polls until terminal status (great for agents)

### Settings (`settings_*`)
- `settings_get` — read masked org+system config
- `settings_validate_bitrix`, `settings_validate_3cx` — non-destructive credential tests
- `org_current` — which organization this token acts as

### Voicemail (`voicemail_*`)
- `voicemail_list`, `voicemail_match`
- `voicemail_search_keyword`, `voicemail_search_hybrid`
- `voicemail_get_audio_url`
- `voicemail_callback_tracker` — last-7-days voicemail callback triage (24h/48h/7d buckets + called-back items; optional `extension` filter)

### Transcripts (`transcript_*`)
- `transcript_check_cache` — advanced transcription (summary, sentiment, action plan, coaching) by **`recordingId`** (e.g. `66968`) or `filename`. The full diarized transcript is omitted unless `includeTranscript: true`, since a long call runs to ~112k characters.
- `transcript_check_cache_batch` — same lookup for up to 100 recordings at once; accepts `recordingIds` or `filenames`.

---

## Example agent flows

### Run a 3CX audit and import missing records
```
1. settings_get                         → confirm Bitrix + 3CX are configured
2. jobs_start_3cx_audit(startDate, endDate)
3. jobs_wait_for_completion(id)
4. audit_data_for_job(jobId)            → review missing records
5. jobs_start_batch_missing_call_records(auditJobId, selectedRecordIds)
6. jobs_wait_for_completion(id)
```

### Find a Bitrix contact by phone and attach a 3CX call
```
1. bitrix_find_contact_by_phone("+1...")
2. threecx_list_recordings({from, to, q: "+1..."})
3. bitrix_create_call_activity({ ownerId, ownerTypeId: "3", callRecord: {...} })
```

### Get an advanced transcription for a call
```
1. transcript_check_cache(recordingId: 66968)
   → if cached, you're done — summary/sentiment/action plan/coaching returned
2. jobs_start_advanced_transcription(recordingId: 66968)
   → only if step 1 returned cached:false (this pays for speech-to-text)
3. jobs_wait_for_completion(id)
4. transcript_check_cache(recordingId: 66968)
```
Add `includeTranscript: true` in step 4 only if you need the verbatim text —
a multi-hour call is ~112k characters.

---

## Security model

- **Tokens are bearer credentials.** Treat `VOIPDOG_SESSION_TOKEN` like a
  password. The web UI reveals it once; it's stored hashed (SHA-256) in the
  backend.
- **Revocation is immediate.** Revoking from **Settings → API Tokens**
  invalidates the next request — no propagation delay.
- **Org scoping is enforced server-side.** A token can only access data in the
  user's current organization, just like the web app.
- **Audit trail.** Every PAT carries a `tokenId` that the backend logs as
  `authSource: pat:<tokenId>` on each authenticated request.

---

## Development

```bash
npm run dev          # node --watch
npm run start        # stdio
npm run start:http   # HTTP transport on :8765
```

Set `VOIPDOG_MCP_DEBUG=1` to log every outgoing request to stderr (stdout is
reserved for MCP framing in stdio mode).

---

## Files

```
VOIP.dog-mcp-server/
├── src/
│   ├── index.js              # entry: subcommand router (server | install | help)
│   ├── install.js            # interactive installer (prompt + write host config)
│   ├── server.js             # MCP server factory; registers all tools
│   ├── config.js             # env-var resolution
│   ├── client/
│   │   ├── apiClient.js      # fetch wrapper, auth, retries
│   │   └── auth.js           # token mgmt (PAT / signin / refresh)
│   └── tools/
│       ├── _helpers.js
│       ├── bitrix.js
│       ├── threecx.js
│       ├── audit.js
│       ├── jobs.js
│       ├── settings.js
│       ├── voicemail.js
│       └── transcript.js
├── package.json
├── .env.example
└── README.md
```
