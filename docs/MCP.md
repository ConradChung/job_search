# Job hunt MCP server

Lets Claude read and work the job hunt app through tools, with the same rules
as the Pipeline page. Built on the Lume MCP framework (vertis-sync
`docs/lume/LUME-MCP.md`): same auth, audit, rate limits, sanitiser, paging and
idempotency conventions.

- **URL:** `https://job-search-two-sandy.vercel.app/api/mcp` (stateless Streamable HTTP, `mcp-handler` 2).
- **Code:** `lib/mcp/` (`auth`, `sanitize`, `limits`, `audit`, `page`, `idempotency`, `tool`, `server`, `tools/*`), route `app/api/mcp/route.ts`.
- **Never:** no tool sends a message, touches LinkedIn or calls the sender.

## Auth

One static bearer token, `JOBHUNT_MCP_TOKEN` (Vercel, Production, sensitive;
64 hex chars). Compared in constant time before the handler sees the request;
anything else gets `401 {"error":"unauthorized"}`. Unset or shorter than 32
characters fails closed. `/api/mcp` skips the app's login middleware and relies
on this check. The owner's copy: `~/.config/jobhunt-mcp/production.env` (mode 600).

Rotate: new value (`openssl rand -hex 32`), replace `JOBHUNT_MCP_TOKEN` in
Vercel, redeploy, update the connector header.

## Rules every call follows

- **Audit:** one `mcp_audit` row per call (tool, class, outcome, ms, sanitised args, refs).
- **Rate limits** (counted from the audit rows; fail closed): 60 reads/min, 20 writes/min, 10 requests/hour.
- **Untrusted text:** posting text, role titles, locations, classifier reasons and people's names and titles come back as `{"untrusted": "…"}`.
- **Secrets** redacted from every result and error; only known errors reach the client.
- **Paging:** `limit` (default 50, max 200) and `cursor`; pass `next_cursor` back. A cursor only works for the query it came from.
- **Emails** are never returned.
- **Arguments** are validated against each tool's schema in the wrapper as well as the SDK.

## Tools

| Tool | Class | What it does |
|---|---|---|
| `jobhunt_get_overview` | read | Start here: counts per tier, notes by status, roles by status, what is waiting on the owner, spend |
| `jobhunt_list_companies` | read | Page-order company rows; filters tier, fit, role status, has people, search |
| `jobhunt_get_company` | read | Roles (classifier reason, fit flags, notes), routing rule, people with note and after-accept message |
| `jobhunt_list_people` | read | People by status and tier |
| `jobhunt_export_preview` | read | The next CSV batch, marking nothing |
| `jobhunt_set_role_status` | write | new / applied / interviewing / rejected / not_fit; rewrites recruiter after-accept messages like the page |
| `jobhunt_set_person_status` | write | sent / replied / no_reply, from Approved, Exported or Sent only |
| `jobhunt_approve_note` | write | Drafted → Approved if it passes every code check |
| `jobhunt_edit_note` | write | Replace a note; same code checks as the page; Approved goes back to Drafted |
| `jobhunt_add_company_note` | write | Append a dated "via Claude" line to the best-fit role's notes |
| `jobhunt_request_find_people` | request | Files a people search (Exa spend) for the owner to confirm |
| `jobhunt_request_draft_notes` | request | Files note drafting (Claude spend) for the owner to confirm |
| `jobhunt_request_export_csv` | request | Files the next export (marks people Exported) for the owner to confirm |

Write tools take an optional `idempotency_key` (a repeat returns the first result
with `replayed: true`; the same key with other arguments is refused).

## Requests

Request tools never act. They file a `pending_actions` row with the preview
(people, companies, estimated cost). The Pipeline page shows "Requests from
Claude" with Confirm and Reject; Confirm runs the page's own flow (find people,
draft notes, export and download) and the row moves awaiting → running →
done/failed, conditionally, so it runs once. Unconfirmed requests expire after a
day. Only `find_people`, `draft_notes` and `export_csv` can be filed.

## Connect

Claude Code:

```bash
set -a; . ~/.config/jobhunt-mcp/production.env; set +a
claude mcp add --transport http job-hunt https://job-search-two-sandy.vercel.app/api/mcp \
  --header "Authorization: Bearer $JOBHUNT_MCP_TOKEN"
```

Claude (desktop / web): Settings → Connectors → Add custom connector, URL as
above, request header `Authorization: Bearer <token>`.

## Tests

`npx vitest run tests/mcp`: token check, paging and cursors, the tool list and
annotations, write checks (edit and approve run the page checks, status
transitions, idempotent replay), sanitiser, rate limits, request kinds.
