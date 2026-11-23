/**
 * Conrad's profile and job-search constraints. THE one place to edit.
 *
 * Drafts may only use facts written here (owner rule: never invent stories,
 * numbers, partners or shared history). Fit flags read `constraints`.
 */

/** systems = GTM systems work; the others are single Blockchain @ UCLA facts (one per note). */
export type ProofKey = 'systems' | 'sdr' | 'kalshi' | 'coinbase' | 'events' | 'partner_team'

export const PROFILE = {
  name: 'Conrad Chung',
  school: 'UCLA',
  graduation: { label: 'March 2027', date: '2027-03-01' },

  /** Blockchain @ UCLA: Head of Growth and Partnerships, October 2023 to present. Drafts name the partner, not the title. */
  club: {
    name: 'Blockchain @ UCLA',
    role: 'Head of Growth and Partnerships, October 2023 to present',
    /** Partner companies (normalized names). Writing to someone at one of these outranks every other proof point. */
    partners: {
      kalshi: { name: 'Kalshi', proof: 'partner_team' },
      coinbase: { name: 'Coinbase', proof: 'partner_team' },
      a16z: { name: 'a16z', proof: 'events', aliases: ['andreessen horowitz'] },
      uniswap: { name: 'Uniswap', proof: 'events', aliases: ['uniswap labs'] },
      deloitte: { name: 'Deloitte', proof: 'events' },
      aptos: { name: 'Aptos', proof: 'events', aliases: ['aptos labs', 'aptos foundation'] },
      zksync: { name: 'ZKsync', proof: 'events', aliases: ['matter labs'] },
      wave: { name: 'Wave Digital Assets', proof: 'events', aliases: ['wave digital assets'] },
    },
  },

  /**
   * Proof points. A draft uses exactly one, chosen in code (lib/drafts/proof.ts).
   * Club facts: owner's words, do not embellish. No counts exist on record
   * (events, attendance, members, dollars): never state or imply one.
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
    /** SDR roles: proof points in order (1) own prospecting, (2) Kalshi, (3) Coinbase (alumni only). No numbers of any kind. */
    sdr: {
      label: 'Own prospecting',
      facts: ['I do my own prospecting, write the copy and handle replies for two startups I co-founded.'],
    },
    kalshi: {
      label: 'Blockchain @ UCLA: Kalshi partnership',
      facts: ['Sourced and closed a campus partnership with Kalshi, negotiating scope and terms directly with their head of growth in New York.'],
      short: "sourced and closed Blockchain @ UCLA's partnership with Kalshi",
    },
    coinbase: {
      label: 'Blockchain @ UCLA: Coinbase outreach',
      facts: ['Cold outreach to Coinbase recruiters that turned into on-campus recruiting initiatives.'],
      short: "cold-emailed Coinbase's recruiters into an on-campus program",
    },
    events: {
      label: 'Blockchain @ UCLA: events',
      facts: ['Hosted events with a16z, Uniswap, Deloitte, Aptos, ZKsync and Wave Digital Assets.'],
      short: 'ran events with a16z and Uniswap at Blockchain @ UCLA',
    },
    partner_team: {
      label: 'Blockchain @ UCLA: worked with this team',
      facts: ['Worked with the recipient\'s team on a campus partnership (Blockchain @ UCLA).'],
      short: 'worked with your team on a campus partnership',
    },
  } satisfies Record<ProofKey, { label: string; facts: string[]; short?: string }>,

  constraints: {
    /**
     * Per-category fit level (owner, 2026-11-23). pass: drafts. warn: shown,
     * still drafts. block: no draft until overridden. Anything not listed blocks.
     */
    categoryLevels: {
      gtm_eng: 'pass',
      sdr: 'pass',
      revops: 'warn',
      growth_eng_product: 'block',
      marketing: 'block',
      ae: 'block',
      account_management: 'block',
      customer_success: 'block',
      sales: 'block',
      partnerships_bd: 'block',
      engineering: 'block',
      other: 'block',
    } as Record<string, 'pass' | 'warn' | 'block'>,
    /**
     * Tracks: the categories that can pass or warn, each with its own badge,
     * filter and stats. GTM Eng is the primary track (company rows prefer it).
     * draft: false pauses drafting for a track (owner: no SDR notes yet).
     */
    tracks: {
      gtm_eng: { label: 'GTM Eng', primary: true, draft: true },
      sdr: { label: 'Sales – SDR/BDR', primary: false, draft: true },
      revops: { label: 'RevOps', primary: false, draft: true },
    } as Record<string, { label: string; primary: boolean; draft: boolean }>,
    /** Seniority that blocks drafting vs. only warns. */
    seniorityBlock: ['senior', 'director_plus'] as string[],
    seniorityWarn: ['mid'] as string[],
    /**
     * Home city: NYC. Pass if the role is based there, the company is
     * headquartered there, or the role is remote within the US. Another city
     * warns (still drafts). Country-only postings show "location unknown" and pass.
     */
    homeLabel: 'NYC',
    homePattern: '\\b(new york|nyc|manhattan|brooklyn|queens|bronx|staten island)\\b',
    /**
     * Staffing agencies and job boards posting for a client (owner, 2026-11-23):
     * always block. Matched on the company name, or LinkedIn's "Staffing and
     * Recruiting" industry.
     */
    staffingPattern:
      '^(tenth revolution|ladders|fde times|robert half|jobot|insight global|teksystems|randstad|adecco|kforce|motion recruitment|hays|michael page|harnham|talentful|cybercoders|aerotek|kelly services|manpower|apex systems|vaco|beacon hill|lhh|hirewell|betts|bowen|frank recruitment|jefferson frank|nigel frank|mason frank|treehouse|underdog\\.io)\\b',
    staffingIndustry: '\\bstaffing\\b',
    /** GTM agencies (owner, 2026-11-24): pass, with an "agency" warning (the role sells for their clients). */
    agencyPattern: '^(demanddrive|the revenue architects)\\b',
    /** Earliest start Conrad can do (graduates March 2027). */
    earliestStart: '2027-03-01',
  },

  /** LinkedIn connection notes: hard character limit used by the generator and the counter. */
  noteLimit: 200,
} as const
