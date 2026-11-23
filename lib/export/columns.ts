/**
 * Sender CSV export: column names and order (GTM-22, CSV hookup).
 * Edit this one file to match the sender's import template. `key` is the
 * field the app fills; `header` is what the column is called in the file.
 * linkedin_url stays first.
 */
export const EXPORT_COLUMNS = [
  { key: 'linkedin_url', header: 'linkedin_url' },
  { key: 'first_name', header: 'first_name' },
  { key: 'last_name', header: 'last_name' },
  { key: 'company', header: 'company' },
  { key: 'title', header: 'title' },
  { key: 'contact_type', header: 'contact_type' },
  { key: 'track', header: 'track' },
  { key: 'role', header: 'role' },
  { key: 'note', header: 'note' },
  { key: 'after_accept_message', header: 'after_accept_message' },
  { key: 'role_status', header: 'role_status' },
  { key: 'company_id', header: 'company_id' },
  { key: 'person_id', header: 'person_id' },
] as const

export type ExportKey = (typeof EXPORT_COLUMNS)[number]['key']
export type ExportRow = Record<ExportKey, string>

/** Import results: accepted header names for the profile URL and the status column (case-insensitive). */
export const IMPORT_URL_HEADERS = ['linkedin_url', 'linkedin', 'profile_url', 'linkedin profile', 'profile', 'url']
export const IMPORT_STATUS_HEADERS = ['status', 'state', 'result', 'outcome']

/** Sender status words → app status. Anything else is listed as unrecognised. */
export const IMPORT_STATUS_MAP: Record<string, 'sent' | 'replied'> = {
  sent: 'sent',
  invited: 'sent',
  'invite sent': 'sent',
  'request sent': 'sent',
  'connection sent': 'sent',
  pending: 'sent',
  connected: 'sent',
  accepted: 'sent',
  replied: 'replied',
  reply: 'replied',
  responded: 'replied',
  'reply received': 'replied',
}

/** Default batch size: about a day's worth of sends. */
export const DEFAULT_BATCH = 15
