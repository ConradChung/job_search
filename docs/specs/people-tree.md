# Spec: company → people tree

Status: draft for approval (2026-11-22). Feeds Linear GTM-21 (contact finder + drafts) and GTM-22 (sender).

## Goal

Under each company in the tracker, show the people to reach out to, grouped by why they matter, with each
person's LinkedIn profile and outreach status. Start from the companies already in `jobs` (Jobs Final).

```
Peec AI · 1 role · tier 1 GTM Eng · Series A · 105 people (small: under 200)
├─ UCLA alumni        Jane Doe · Account Executive        in  · not contacted
├─ Recruiting         Ana K. · Head of Talent              in  · not contacted
├─ GTM leadership     Sam Lee · Head of Growth             in  · drafted
└─ Executive          Marco P. · Co-founder & CEO          in  · sent 11/24
```

## Where the people come from

What exists today (measured 2026-11-22):

| Source | Coverage | Cost |
|---|---|---|
| Job poster in Jobs Final (`jobPosterName/Title/ProfileUrl`) | 48 of 528 jobs | free, already imported |
| `gtm` tab in the sheet | 0 of the Jobs Final companies (it covers an older batch) | not useful |
| Apollo API people search | **blocked**: the account is on the Free plan; `mixed_people/api_search` returns `API_INACCESSIBLE` (tested today) | needs a paid plan |
| Clay `search-contacts` (connector) | any company by domain or LinkedIn URL, 10 companies per call, per-company cap, **school filter** for UCLA | spare Clay credits (owner to confirm before first run) |
| Exa search API (`category: "people"` / LinkedIn profiles) | natural-language search such as "UCLA alumni working at Peec AI" or "Head of Growth at peec.ai"; returns LinkedIn profile URLs plus page text | spare Exa credits; plain API key, so it can run **inside the deployed app** |
| LinkedIn search links | always available, manual click | free |

**Recommendation: Exa for the in-app button, Clay for precise checks, Apollo only if you upgrade.**

- **Exa** is the only source that can sit behind a "Find people" button in the Vercel app (an `EXA_API_KEY`
  env var, server-side fetch). Its search is semantic, so results need a light parse to get name and title
  from the profile text, and each person gets a confidence flag. Untested so far: the Exa connector here
  still needs auth, so the first run is a 10-company trial to measure hit rate.
- **Clay** has hard structured filters (`education.any(school_name ...)`, current title, per-company cap),
  so it's the better tool for the UCLA branch and for filling gaps Exa misses. It runs from a Claude Code
  session (MCP connector), not from the app.

Earlier note on Clay: Clay has the one filter that matters most here
(`education.any(school_name contains "UCLA")`), returns LinkedIn URLs, and runs against credits you already
have. Apollo can't search people on the Free plan at all; the existing Apollo UI-link → Leadsfriday path in
vertis-sync has a 500-contact minimum per order, which is too coarse for 2–3 hand-picked people per company.

## Who to target (owner rules, 2026-11-22)

Targeting depends on company size, from `companyEmployeesCount` in the sheet (falling back to the
`companySize` text). **Cutoff: 200 employees** (default, change in one constant). In Jobs Final, with size
known for 437 of 529 companies, 277 are under 200 and 160 are 200 or more. Unknown size is treated as small.

**Larger companies (200+): recruiting first.** Look for the head of recruiting for the sales team, or an
adjacent vertical.

| Order | Target | Example titles |
|---|---|---|
| 1 | Sales / GTM recruiting lead | Head of Sales Recruiting, GTM Recruiting Lead, Talent Acquisition Manager (Sales / Revenue / GTM) |
| 2 | Adjacent recruiting lead | Head of Recruiting / Talent, Recruiting Manager for Business or Go-to-Market, Senior Recruiter (Sales) |
| 3 | Recruiters on the sales team | Recruiter or Technical Recruiter with sales or GTM in their title or profile |

**Smaller companies (under 200): top of the chain.**

| Order | Target | Example titles |
|---|---|---|
| 1 | Head of recruiting, if there is one | Head of Talent, Head of People & Recruiting, Founding Recruiter |
| 2 | Head of GTM or head of sales | Head of GTM, Head of Sales, Head of Growth, Head of RevOps, GTM Lead |
| 3 | Adjacent but more senior | VP Sales, VP Revenue, CRO, COO, Co-founder / CEO |

Each level is only used when the one above has nobody. Within a level, more senior and more relevant to
sales or GTM ranks first.

## Tree branches

The tree groups people by why they're on it. One person sits in one branch only: the highest that applies.
**Cap: 3 people per branch.**

| Branch | Who | Notes |
|---|---|---|
| UCLA alumni | anyone at the company who went to UCLA | Always searched, any size. Shown first because a warm angle beats seniority. |
| Recruiting | the recruiting targets above | The main branch for larger companies, and level 1 for smaller ones. |
| GTM leadership | Head of Growth, VP Sales, Head of RevOps, GTM Lead (owner confirmed), plus Head of GTM / Head of Sales | The main branch for smaller companies. |
| Executive | VP Revenue, CRO, COO, founder / CEO | Smaller companies only, as the "higher up the chain" fallback. |
| Job poster | whoever posted the role (from the sheet) | Already have 48. |

Search queries (Clay DSL shown; Exa uses the same titles as natural-language queries):

- Alumni: `education.any(school_name contains ("UCLA", "University of California, Los Angeles"))`
- Recruiting, larger: `experiences.any(is_current = true and job_title is_similar_to ("Sales Recruiter", "GTM Recruiting Lead", "Head of Talent Acquisition", "Recruiting Manager"))`
- Recruiting, smaller: `experiences.any(is_current = true and job_title is_similar_to ("Head of Talent", "Head of Recruiting", "Founding Recruiter"))`
- GTM leadership: `experiences.any(is_current = true and job_title is_similar_to ("Head of GTM", "Head of Sales", "Head of Growth", "VP Sales", "Head of RevOps", "GTM Lead"))`
- Executive (smaller only): `experiences.any(is_current = true and job_title is_similar_to ("CRO", "VP Revenue", "COO", "Founder", "CEO"))`
- All: `limit 3 by clay_company_id`

## Data model (new tables)

```sql
create table people (
  id              bigint generated always as identity primary key,
  company_key     text not null,              -- joins jobs.company_key
  full_name       text not null,
  title           text,
  linkedin_url    text not null,
  linkedin_key    text not null,              -- normalized /in/<slug>, unique per company
  branch          text not null check (branch in ('alumni','recruiting','gtm_leadership','executive','poster','other')),
  size_band       text check (size_band in ('small','large')),   -- the rule set used (200-employee cutoff)
  is_ucla         boolean not null default false,
  rank            smallint,                   -- 1 = reach out first
  source          text not null check (source in ('sheet_poster','exa','clay','apollo','manual')),
  confidence      text check (confidence in ('high','medium','low')),  -- Exa matches are fuzzy
  outreach_status text not null default 'none' check (outreach_status in ('none','drafted','approved','sent','replied','skip')),
  last_contacted_at timestamptz,
  notes           text,
  raw             jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_key, linkedin_key)
);

create table people_runs (                   -- one row per "find people" run, for cost tracking
  id bigint generated always as identity primary key,
  source text not null, companies int not null, people_found int not null,
  credits_used numeric, started_at timestamptz not null default now(), error text
);
```

Same access model as `jobs`: RLS on, no policies, server uses the service role behind the owner gate.

## UI

1. **Companies view** (`/companies`): one row per company (roles, best tier, funding, people count). Each row
   expands into the tree above. Each person shows name, title, a LinkedIn icon, the branch, and an outreach
   status pill you can change, like job status.
2. **Jobs table**: a "People" chip per row (e.g. `3 people`) that opens that company's tree in a side panel.
3. **No people yet?** The company row shows three LinkedIn search links (UCLA alumni at company, GTM team,
   recruiters) plus a "Find people" button.
4. **Add manually**: paste a LinkedIn profile URL plus a branch.

## Finding people (the run)

- "Find people" works on one company, or on a filter (default: tier 1–2, status New or Reached out, no
  people yet).
- Server batches 10 companies per Clay call (by `company_website` domain, falling back to `company_linkedin`),
  runs the four branch queries, dedupes on LinkedIn slug, ranks, and writes `people`.
- A preview before every run: companies × queries and the estimated Clay credits; the run needs your OK.
- No emails in this step. Emails (if ever needed) come later, only for people you mark approved.

Implementation note: the Clay connector is a claude.ai MCP tool, not a REST API with a key in this app. Phase 2
therefore runs from a Claude Code session (a `find-people` script/skill that writes to Supabase), not from
the Vercel app. If Clay exposes an API key or webhook table on your plan, the button can call it directly
later.

## Phases

| Phase | What | Spend |
|---|---|---|
| 1 | `people` table, Companies tree view, People chip, LinkedIn search links, manual add, seed 48 job posters | none |
| 2a | Exa "Find people" button in the app (per company or filtered batch), parse + rank, preview + approval, `people_runs` log | Exa credits (estimate shown first) |
| 2b | Clay pass from a Claude Code session for UCLA alumni and companies Exa came back thin on | Clay credits |
| 3 | GTM-21 drafts per person, GTM-22 sender reads `approved` people and writes back `sent` / `replied` | as per those issues |
| opt | If Apollo is upgraded: Apollo search as a second source in the same run | Apollo plan |

## Decisions

Settled 2026-11-22: size-based targeting (above), GTM leadership titles confirmed, cap of 3 per branch.

Still open:
1. Exa first (in-app button), with Clay for UCLA alumni and gaps? If yes: the Exa API key (added to Vercel env
   or `.env.local` by you, never in chat) and which Clay workspace.
2. Is 200 employees the right line between small and large?
