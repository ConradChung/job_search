import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { NavLinks } from '@/components/shell/NavLinks'

/** Floating corner controls, Lume-style: brand pill top-left, theme + sign-out top-right. */
export function TopBar() {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-start justify-between p-4">
      <Link href="/" className="glass brand pointer-events-auto h-11 rounded-full px-4">
        <span className="size-2 rounded-full bg-primary dark:shadow-(--primary-glow)" aria-hidden />
        job hunt
      </Link>
      <NavLinks />
      <div className="glass pointer-events-auto flex h-11 items-center gap-1 rounded-full px-1">
        <ThemeToggle />
        <form action="/api/auth/sign-out" method="post">
          <button
            type="submit"
            aria-label="Sign out"
            title="Sign out"
            className="inline-flex size-9 items-center justify-center rounded-full text-fg-46 transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </form>
      </div>
    </div>
  )
}
