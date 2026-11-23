/** Owner's size bands (2026-11-22): small < 30, medium 30–100, large > 100 employees. */
export type SizeBand = 'small' | 'medium' | 'large'

export const SMALL_MAX = 29
export const MEDIUM_MAX = 100

/**
 * Band from the employee count, falling back to the sheet's size range text
 * ("51-200 employees", "10,001+"). A range that straddles a boundary, or no
 * data at all, counts as medium.
 */
export function sizeBand(employees: number | null | undefined, sizeText?: string | null): SizeBand {
  if (typeof employees === 'number' && Number.isFinite(employees) && employees > 0) {
    if (employees <= SMALL_MAX) return 'small'
    if (employees <= MEDIUM_MAX) return 'medium'
    return 'large'
  }
  const nums = (sizeText ?? '').replace(/,/g, '').match(/\d+/g)?.map(Number) ?? []
  if (nums.length) {
    const lo = nums[0]
    const hi = nums[nums.length - 1]
    if (/\+/.test(sizeText ?? '') && lo > MEDIUM_MAX) return 'large'
    if (hi <= SMALL_MAX) return 'small'
    if (lo > MEDIUM_MAX) return 'large'
  }
  return 'medium'
}

export const BAND_LABEL: Record<SizeBand, string> = {
  small: 'Small · under 30',
  medium: 'Medium · 30–100',
  large: 'Large · 100+',
}
