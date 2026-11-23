'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const LINKS = [{ href: '/', label: 'Pipeline' }]

export function NavLinks() {
  const pathname = usePathname()
  return (
    <nav aria-label="Main" className="glass pointer-events-auto flex h-11 items-center gap-1 rounded-full px-1">
      {LINKS.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href)
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={cn('inline-flex h-9 items-center rounded-full px-3.5 text-[13px] transition-colors', active ? 'bg-primary/15 text-fg' : 'text-fg-46 hover:text-fg')}
          >
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
