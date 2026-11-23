# Spec: company → people tree

Status: **built 2026-11-22** (phases 1 + 2a: people table, Companies tree, Exa find-people; Clay not wired). See "Build notes" at the end. Feeds Linear GTM-21 (contact finder + drafts) and GTM-22 (sender).

## Goal

Under each company in the tracker, show the people to reach out to, grouped by why they matter, with each
person's LinkedIn profile and outreach status. Start from the companies already in `jobs` (Jobs Final).

```
Peec AI · 1 role · tier 1 GTM Eng · Series A · 105 people (large: over 100)
├─ UCLA alumni        Jane Doe · Account Executive        in  · not contacted
├─ Recruiting         Aaron K. · GTM Hiring                in  · not contacted
└─ GTM leadership     Xanthe P. · Head of Sales            in  · drafted
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
  from the profile text, and each person gets a confidence flag. **Trial 2026-11-22** (one search, "Head of Sales or Head of GTM at Peec AI",
  `category: "people"`): 5 of 5 results were current Peec AI staff, including their Head of Sales, Head of Sales
  EMEA and GTM Hiring lead. Each result has the LinkedIn URL, the profile headline (current title @ company),
  location, about, and experience with the current role marked, so title, current employer and education can
  be parsed without another call. Cost: **$0.007 per search** (with 400 characters of text).
- **Cost estimate:** about 4 searches per company (alumni + up to 3 target levels, stopping early when a level
  fills): about $0.03 per company, about $7 for the ~240 tier 1–2 companies, about $16 for all 523.
- **Clay** has hard structured filters (`education.any(school_name ...)`, current title, per-company cap),
  so it's the better tool for the UCLA branch and for filling gaps Exa misses. It runs from a Claude Code
  session (MCP connector), not from the app.

Earlier note on Clay: Clay has the one filter that matters most here
(`education.any(school_name contains "UCLA")`), returns LinkedIn URLs, and runs against credits you already
have. Apollo can't search people on the Free plan at all; the existing Apollo UI-link → Leadsfriday path in
vertis-sync has a 500-contact minimum per order, which is too coarse for 2–3 hand-picked people per company.

## Who to target (owner rules, 2026-11-22)

Targeting depends on company size, from `companyEmployeesCount` in the sheet (falling back to the
`companySize` text). Bands set by the owner; counts are from Jobs Final:

| Band | Employees | Companies |
|---|---|---|
| Small | under 30 | 69 |
| Medium | 30 to 100 | 123 |
| Large | over 100 | 245 |
| Unknown | not in the sheet | 92 (treated as medium until a size is found) |

**Large (over 100): recruiting for the sales team first.**

| Order | Target | Example titles |
|---|---|---|
| 1 | Sales / GTM recruiting lead | Head of Sales Recruiting, GTM Recruiting Lead, GTM Hiring, Talent Acquisition Manager (Sales / Revenue) |
| 2 | Adjacent recruiting lead | Head of Recruiting / Talent, Recruiting Manager (Business / GTM), Senior Recruiter (Sales) |
| 3 | Recruiters on the sales team | Recruiter with sales or GTM in their title or profile |

**Small (under 30): top of the chain.**

| Order | Target | Example titles |
|---|---|---|
| 1 | Head of recruiting, if there is one | Head of Talent, Founding Recruiter, Head of People |
| 2 | Head of GTM or head of sales | Head of GTM, Head of Sales, Head of Growth, Head of RevOps, GTM Lead |
| 3 | Adjacent but more senior | VP Sales, CRO, COO, Co-founder / CEO |

**Medium (30 to 100): proposed default, owner to confirm.** A blend: these companies often have one
recruiter and a real GTM leader, but the founder is less likely to be the right first touch.

| Order | Target | Example titles |
|---|---|---|
| 1 | Head of recruiting / GTM recruiter | Head of Talent, Recruiting Lead, GTM Hiring |
| 2 | Head of GTM or head of sales | Head of GTM, Head of Sales, Head of Growth, Head of RevOps, GTM Lead |
| 3 | Adjacent but more senior | VP Sales, VP Revenue, CRO (founder / CEO only if levels 1 and 2 come up empty) |

Each level is only used when the one above has nobody. Within a level, more senior and more relevant to
sales or GTM ranks first.

## Tree branches

The tree groups people by why they're on it. One person sits in one branch only: the highest that applies.
**Cap: 3 people per branch.**

| Branch | Who | Notes |
|---|---|---|
| UCLA alumni | anyone at the company who went to UCLA | Always searched, any size. Shown first because a warm angle beats seniority. |
| Recruiting | the recruiting targets above | The main branch for large companies, and level 1 for small and medium. |
| GTM leadership | Head of Growth, VP Sales, Head of RevOps, GTM Lead (owner confirmed), plus Head of GTM / Head of Sales | The main branch for small and medium companies. |
| Executive | VP Revenue, CRO, COO, founder / CEO | Small and medium only, as the "higher up the chain" fallback. |
| Job poster | whoever posted the role (from the sheet) | Already have 48. |

Search queries (Clay DSL shown; Exa uses the same titles as natural-language queries):

- Alumni: `education.any(school_name contains ("UCLA", "University of California, Los Angeles"))`
- Recruiting, large: `experiences.any(is_current = true and job_title is_similar_to ("Sales Recruiter", "GTM Recruiting Lead", "Head of Talent Acquisition", "Recruiting Manager"))`
- Recruiting, small / medium: `experiences.any(is_current = true and job_title is_similar_to ("Head of Talent", "Head of Recruiting", "Founding Recruiter"))`
- GTM leadership: `experiences.any(is_current = true and job_title is_similar_to ("Head of GTM", "Head of Sales", "Head of Growth", "VP Sales", "Head of RevOps", "GTM Lead"))`
- Executive (small / medium only): `experiences.any(is_current = true and job_title is_similar_to ("CRO", "VP Revenue", "COO", "Founder", "CEO"))`
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
  size_band       text check (size_band in ('small','medium','large')),   -- rule set used: <30 / 30-100 / >100
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

Settled 2026-11-22: size bands (under 30 / 30 to 100 / over 100), GTM leadership titles, cap of 3 per branch,
Exa as the main source (key in `.env.local` and Vercel production env as `EXA_API_KEY`).

Still open:
1. The medium-band rules above (proposed default).
2. Clay for the UCLA branch and gaps, or Exa only? Exa can search "UCLA alumni at <company>"; Clay's
   school filter is stricter.

## Build notes (2026-11-22)

- **Fallback reading of the owner's rules:** small and medium companies search recruiting **and** GTM leadership
  together; "higher up the chain" only runs when no GTM / sales head turns up. Large companies fall through the
  recruiting levels in order. Code: `lib/people/targets.ts` (`PLANS`).
- **Company match:** a person counts only if a "(Current)" role names the company exactly (high confidence) or
  the headline ends in "@ Company" (medium; shown with a "check" tag). No prefix matching ("Engine" is not
  "Engine Room").
- **Alumni ranking:** GTM / sales / recruiting alumni rank above engineers and other roles.
- **Trial, 10 tier-1 companies:** 32 searches, **$0.238**, 29 people saved (plus 48 job posters seeded),
  UCLA alumni at 4 of 10. Large companies got talent leads (VP Talent Acquisition, Head of Global TA), medium got
  GTM leaders (VP RevOps, Global Head of Sales Development), and a company with no GTM head fell back to its
  co-founders.
- **Run it:** Companies page → "Find people" (per company or for the filtered list, after a cost preview), or
  `npm run people -- --tier 2 --limit 50` (preview) then add `--yes`.
