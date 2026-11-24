# job_search

Conrad's job hunt app (Next.js 15, Supabase project `job-hunt`, MCP server at
`/api/mcp`). Start with `README.md`, `docs/MCP.md` and `feature-map.md`.

## Checks

`npm run lint && npm run typecheck && npm test && npx tsx .claude/hooks/owner-rules.ts`
(`npm run build` for UI or route changes). Never run the `.env.local` scripts
(`sync`, `people`, `drafts`, `weekly`, ...) to check work: they spend money and
write the live data.

## Verification

Work comes back to Conrad only after it has checked itself.

1. Before you change anything, delete `review/verdict.txt`.
2. Before you say you're done, run the `verify-app` subagent (it runs on
   Fable, reads only, and never edits source). Pass it your final summary: what
   you changed and what you claim works. It runs the checks, reads the diff
   against `feature-map.md`, and writes `PASS` or `FAIL` plus next
   instructions to `review/verdict.txt`.
3. On FAIL, follow its next instructions, delete the verdict and run it again.
   The Stop hook (`.claude/hooks/require-checks.sh`) won't let you finish
   while lint, typecheck, tests, the owner rules or the verdict fail, and
   hands the reason back to you. After 3 blocked rounds it lets you stop: then
   tell Conrad exactly what still fails.
4. Anything Conrad has had to say twice becomes a hard check: add it to
   `.claude/hooks/owner-rules.ts` (or the hard checks in `require-checks.sh`)
   and to `feature-map.md`. Don't loosen or delete a hard check, a test or a
   feature-map rule to get a PASS; change one only when Conrad asks.
5. When you add or change a feature, update its `feature-map.md` entry.

`claude --bare -p` (bare headless mode) skips local hooks, so the Stop hook
doesn't run there; run the checks and `verify-app` yourself.
