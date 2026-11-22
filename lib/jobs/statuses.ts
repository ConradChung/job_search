/** The tracking pipeline, in board order. Stored as the `value`. */
export const STATUSES = [
  { value: 'new', label: 'New', tone: 'idle' },
  { value: 'reached_out', label: 'Reached out', tone: 'run' },
  { value: 'applied', label: 'Applied', tone: 'wait' },
  { value: 'interviewing', label: 'Interviewing', tone: 'run' },
  { value: 'offer', label: 'Offer', tone: 'ok' },
  { value: 'rejected', label: 'Rejected', tone: 'bad' },
  { value: 'not_fit', label: 'Not a fit', tone: 'bad' },
] as const

export type Status = (typeof STATUSES)[number]['value']
export type Tone = (typeof STATUSES)[number]['tone']

export const STATUS_VALUES: readonly string[] = STATUSES.map((s) => s.value)

export function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && STATUS_VALUES.includes(v)
}

export function statusMeta(v: string) {
  return STATUSES.find((s) => s.value === v) ?? STATUSES[0]
}

/**
 * Sheet "status" text → pipeline value. Only used when a row is first
 * imported; after that the dashboard owns status. Unknown text maps to 'new'
 * (the original stays in `raw`).
 */
export function statusFromSheet(text: string): Status {
  const t = text.trim().toLowerCase()
  if (!t) return 'new'
  if (t.includes('not a right fit') || t.includes('not a fit')) return 'not_fit'
  if (t.includes('reject')) return 'rejected'
  if (t.includes('offer')) return 'offer'
  if (t.includes('interview')) return 'interviewing'
  if (t.includes('applied')) return 'applied'
  if (t.includes('reached') || t.includes('sent') || t.includes('messaged')) return 'reached_out'
  return 'new'
}
