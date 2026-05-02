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

### 1. Install

```bash
cd VOIP.dog-mcp-server
npm install
```

### 2. Get an API token

In the web app: **Settings → API Tokens → Generate token**. Pick a label (e.g.
`Claude Code (laptop)`) and a lifetime (90 days is a good default). Copy the
token — it starts with `voipdog_pat_` and is only shown once.

> SSO users (Microsoft / Google) and email users alike can use this. The token
> is independent of your login provider.

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
VOIPDOG_API_BASE_URL=https://api.voip.dog/api
VOIPDOG_SESSION_TOKEN=voipdog_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4. Wire it into your agent

#### Claude Code

Add to `~/.claude/mcp.json` (or your project `.mcp.json`):

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

#### Gemini CLI

In `~/.gemini/settings.json`:

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

#### Anything else (OpenAI Agents, custom MCP clients)

Run as a subprocess and connect over stdio, or run with `--http` and connect
over Streamable HTTP at `http://127.0.0.1:8765/mcp`.

```bash
npm run start:http
```

---

## Authentication

Two modes, in priority order:

1. **API token** (recommended) — set `VOIPDOG_SESSION_TOKEN`. Works for SSO and
   email users. Generate from **Settings → API Tokens** in the web app.
2. **Email + password** — set `VOIPDOG_EMAIL` + `VOIPDOG_PASSWORD`. The MCP
   server signs in via `POST /api/auth/signin` and auto-refreshes. Only works
   for `provider="email"` accounts; SSO accounts must use option 1.

The MCP server stores nothing on disk; tokens live only in memory after the
sign-in call (when applicable).

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

### Background jobs (`jobs_*`)
- `jobs_list_types`, `jobs_list`, `jobs_get`, `jobs_get_logs`
- `jobs_start_3cx_audit` — kicks off a date-range audit
- `jobs_start_batch_missing_call_records` — import missing 3CX activities
- `jobs_start_batch_missing_transcripts` — backfill transcripts
- `jobs_start_contact_activity_search`
- `jobs_cancel`, `jobs_delete`
- `jobs_wait_for_completion` — polls until terminal status (great for agents)

### Settings (`settings_*`)
- `settings_get` — read masked org+system config
- `settings_validate_bitrix`, `settings_validate_3cx` — non-destructive credential tests

### Voicemail (`voicemail_*`)
- `voicemail_list`, `voicemail_match`
- `voicemail_search_keyword`, `voicemail_search_hybrid`
- `voicemail_get_audio_url`

### Transcripts (`transcript_*`)
- `transcript_check_cache`, `transcript_check_cache_batch`

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
│   ├── index.js              # entry: stdio default, --http for HTTP
│   ├── server.js             # MCP server factory; registers all tools
│   ├── config.js             # env parsing
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
