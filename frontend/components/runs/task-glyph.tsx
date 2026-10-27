import { cn } from '@/lib/utils'

// A small drawing of each task's product: the task's mark wherever it is named.
export function TaskGlyph({ slug, className }: { slug: string; className?: string }) {
  const common = { viewBox: '0 0 40 40', 'aria-hidden': true, className: cn('size-10 shrink-0 text-foreground', className) }
  if (slug === 'marketplace') {
    // A shopping bag with a tag.
    return (
      <svg {...common}>
        <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round">
          <path d="M8 14h24l-2 20H10z" />
          <path d="M15 17v-5a5 5 0 0 1 10 0v5" />
        </g>
        <circle cx="29" cy="11" r="4" className="fill-primary" />
      </svg>
    )
  }
  if (slug === 'hotels') {
    // A building with lit windows and a bed sign.
    return (
      <svg {...common}>
        <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round">
          <path d="M9 35V7h22v28M5 35h30M17 35v-6h6v6" />
        </g>
        {[13, 19, 25].map((y) => [13.5, 19, 24.5].map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y - 2} width="2.5" height="2.5" className={x === 19 && y === 19 ? 'fill-primary' : 'fill-foreground'} />
        )))}
      </svg>
    )
  }
  if (slug === 'cinema') {
    // A screen with a play button.
    return (
      <svg {...common}>
        <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round">
          <rect x="4.75" y="8.75" width="30.5" height="20.5" rx="2" />
          <path d="M14 34h12M20 29.5V34" />
        </g>
        <path d="M17 14.5v9l8-4.5z" className="fill-primary" />
      </svg>
    )
  }
  if (slug === 'messenger') {
    // Two speech bubbles, the newer one lit.
    return (
      <svg {...common}>
        <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round">
          <path d="M5 9.75h20v12H13l-5 4.5v-4.5H5z" />
          <path d="M29 15.75h6v12h-3v4.5l-5-4.5h-8v-3" />
        </g>
        <circle cx="31" cy="10" r="4" className="fill-primary" />
      </svg>
    )
  }
  if (slug === 'city-trip') {
    // A route between pins over a river.
    return (
      <svg {...common}>
        <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" strokeLinecap="round">
          <path d="M4 22c6-3 10 3 16 0s10-3 16 0" />
          <path d="M11 33c0-6 9-4 10-10s8-6 9-12" strokeDasharray="2 3" />
          <path d="M11 33.5c-2.5-3-4-5-4-7a4 4 0 0 1 8 0c0 2-1.5 4-4 7z" />
        </g>
        <path d="M30 13.5c-2.5-3-4-5-4-7a4 4 0 0 1 8 0c0 2-1.5 4-4 7z" className="fill-primary" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="6.75" y="6.75" width="26.5" height="26.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}
