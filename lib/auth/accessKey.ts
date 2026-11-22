/**
 * Private-link access: visiting /k/<ACCESS_KEY> sets an httpOnly cookie that
 * lets the browser in without a magic link. Unset ACCESS_KEY (or one shorter
 * than 24 chars) disables it; fails closed.
 */
export const ACCESS_COOKIE = 'jh_access'

export function accessKeyMatches(given: string | undefined | null, expected = process.env.ACCESS_KEY): boolean {
  if (!given || !expected || expected.length < 24) return false
  // Constant-time compare (runs in the Edge runtime too, so no node:crypto).
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]
  return diff === 0
}
