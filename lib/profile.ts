/**
 * Conrad's profile and job-search constraints. THE one place to edit.
 *
 * Drafts may only use facts written here (owner rule: never invent stories,
 * numbers, partners or shared history). Fit flags read `constraints`.
 */

export type ProofKey = 'systems' | 'club'

export const PROFILE = {
  name: 'Conrad Chung',
  school: 'UCLA',
  graduation: { label: 'March 2027', date: '2027-03-01' },

  /**
   * Proof points. A draft uses exactly one, chosen in code by role category
   * and company (lib/drafts/proof.ts). Never both in one note.
   */
  proof: {
    systems: {
      label: 'GTM systems',
      facts: [
        'Built and shipped a full-stack GTM platform solo.',
        'Runs outbound for two startups he co-founded.',
        'Builds outbound lead pipelines, enrichment and lead validation with tools like Clay, Exa, Apify and Supabase.',
      ],
    },
    club: {
      label: 'Blockchain @ UCLA',
      facts: [
        'Head of Growth and Partnerships at Blockchain @ UCLA since October 2023.',
        // FILL IN (owner): two or three things you did there, with partner names and one number.
        // Until these are filled in, club notes can only state the role above.
      ],
    },
  } satisfies Record<ProofKey, { label: string; facts: string[] }>,

  constraints: {
    /** Role categories Conrad drafts for. Anything else is a blocking fit flag. */
    categories: ['gtm_eng'] as string[],
    /** Seniority that blocks drafting vs. only warns. */
    seniorityBlock: ['senior', 'director_plus'] as string[],
    seniorityWarn: ['mid'] as string[],
    /**
     * Places Conrad can work (matched against the posting's location
     * requirement). FILL IN (owner). Empty = location is not checked and the
     * row shows "location not checked".
     */
    locations: [] as string[],
    /** Remote roles always pass the location check. */
    remoteOk: true,
    /** Earliest start Conrad can do (graduates March 2027). */
    earliestStart: '2027-03-01',
  },

  /** LinkedIn connection notes: hard character limit used by the generator and the counter. */
  noteLimit: 250,
} as const
