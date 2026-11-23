import type { Searcher } from './find'

const ENDPOINT = 'https://api.exa.ai/search'

/** Exa people search: LinkedIn profiles with up to 3,000 chars of profile text. */
export function exaSearcher(apiKey = process.env.EXA_API_KEY, numResults = 10): Searcher {
  if (!apiKey) throw new Error('EXA_API_KEY is not set')
  return async (query) => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ query, category: 'people', numResults, contents: { text: { maxCharacters: 3000 } } }),
      cache: 'no-store',
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Exa ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = (await res.json()) as { results?: { url: string; title?: string; text?: string }[]; costDollars?: { total?: number } }
    return { results: data.results ?? [], cost: Number(data.costDollars?.total ?? 0) }
  }
}
