import { redirect } from 'next/navigation'

/** Merged into the one page at /. */
export default async function Moved({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const { open } = await searchParams
  redirect(open ? `/?open=${encodeURIComponent(open)}` : '/')
}
