/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and
 * newlines inside quotes, CRLF or LF line endings. Enough for Google Sheets'
 * CSV export, without a dependency.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  while (i < src.length) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
      } else {
        field += c
      }
      i++
      continue
    }
    if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (c === '\r' && src[i + 1] === '\n') i++
    } else {
      field += c
    }
    i++
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
