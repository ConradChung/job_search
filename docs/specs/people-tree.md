# Spec: company → people tree

Status: draft for approval (2026-11-22). Feeds Linear GTM-21 (contact finder + drafts) and GTM-22 (sender).

## Goal

Under each company in the tracker, show the people to reach out to, grouped by why they matter, with each
person's LinkedIn profile and outreach status. Start from the companies already in `jobs` (Jobs Final).

```
Peec AI · 1 role · tier 1 GTM Eng · Series A · 105 people
├─ UCLA alumni        Jane Doe · Account Executive        in  · not contacted
├─ Hiring team        Sam Lee · Head of Growth            in  · drafted
├─ Leadership         Marco P. · Co-founder & CEO          in  · sent 11/24
└─ Recruiting         Ana K. · Talent Partner              in  · not contacted
```

## Where the people come from

What exists today (measured 2026-11-22):

| Source | Coverage | Cost |
|---|---|---|
| Job poster in Jobs Final (`jobPosterName/Title/ProfileUrl`) | 48 of 528 jobs | free, already imported |
| `gtm` tab in the sheet | 0 of the Jobs Final companies (it covers an older batch) | not useful |
| Apollo API people search | **blocked**: the account is on the Free plan; `mixed_people/api_search` returns `API_INACCESSIBLE` (tested today) | needs a paid plan |
| Clay `search-contacts` (connector) | any company by domain or LinkedIn URL, 10 companies per call, per-company cap, **school filter** for UCLA | spare Clay credits (owner to confirm before first run) |
| LinkedIn search links | always available, manual click | free |

**Recommendation: Clay first, Apollo only if you upgrade.** Clay has the one filter that matters most here
(`education.any(school_name contains "UCLA")`), returns LinkedIn URLs, and runs against credits you already
have. Apollo can't search people on the Free plan at all; the existing Apollo UI-link → Leadsfriday path in
vertis-sync has a 500-contact minimum per order, which is too coarse for 2–3 hand-picked people per company.

## Tree branches and ranking

One person can match several branches; they're shown once, in the highest branch.

| Rank | Branch | Who | Clay query (current employees) |
|---|---|---|---|
| 1 | UCLA alumni | anyone at the company who went to UCLA | `education.any(school_name contains ("UCLA", "University of California, Los Angeles"))` |
| 2 | Hiring team | GTM / growth / RevOps / sales leads (the team the role sits in) | `experiences.any(is_current = true and job_title is_similar_to ("Head of Growth", "VP Sales", "Head of RevOps", "GTM Lead"))` |
| 3 | Leadership | founders / CEO (default first for companies under 50 people) | `job_title is_similar_to ("Founder", "CEO")` |
| 4 | Recruiting | recruiters / talent partners | `job_title is_similar_to ("Recruiter", "Talent Acquisition")` |
| — | Job poster | the person who posted the role (from the sheet) | none, already have it |

Per company: keep up to 3 per branch, then surface the top 3 overall as the outreach shortlist (GTM-21's cap).

## Data model (new tables)

```sql
create table people (
  id              bigint generated always as identity primary key,
  company_key     text not null,              -- joins jobs.company_key
  full_name       text not null,
  title           text,
  linkedin_url    text not null,
  linkedin_key    text not null,              -- normalized /in/<slug>, unique per company
  branch          text not null check (branch in ('alumni','hiring_team','leadership','recruiting','poster','other')),
  is_ucla         boolean not null default false,
  rank            smallint,                   -- 1 = reach out first
  source          text not null check (source in ('sheet_poster','clay','apollo','manual')),
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
| 2 | Clay "find people" run for tier 1–2 companies, preview + approval, `people_runs` log | Clay credits (estimate shown first) |
| 3 | GTM-21 drafts per person, GTM-22 sender reads `approved` people and writes back `sent` / `replied` | as per those issues |
| opt | If Apollo is upgraded: Apollo search as a second source in the same run | Apollo plan |

## Decisions needed

1. Use Clay (spare credits) as the people source? If yes, confirm which Clay account or workspace.
2. Per-company cap: 3 per branch / top 3 overall OK?
3. "Hiring team" titles: are Head of Growth / VP Sales / Head of RevOps / GTM Lead the right buckets?
