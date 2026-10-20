import { cn } from '@/lib/utils'

// A small drawing of each task's data structure: the task's mark wherever it is named.
export function TaskGlyph({ slug, className }: { slug: string; className?: string }) {
  const common = { viewBox: '0 0 40 40', 'aria-hidden': true, className: cn('size-10 shrink-0 text-foreground', className) }
  if (slug === 'rbtree') {
    return (
      <svg {...common}>
        <g stroke="currentColor" strokeWidth="1.5" fill="none">
          <path d="M20 8 11 19M20 8l9 11M11 19l-5 11M11 19l5 11M29 19l5 11" />
        </g>
        <circle cx="20" cy="8" r="4" className="fill-foreground" />
        <circle cx="11" cy="19" r="4" className="fill-destructive" />
        <circle cx="29" cy="19" r="4" className="fill-foreground" />
        <circle cx="6" cy="31" r="3" className="fill-foreground" />
        <circle cx="16" cy="31" r="3" className="fill-foreground" />
        <circle cx="34" cy="31" r="3" className="fill-destructive" />
      </svg>
    )
  }
  if (slug === 'linked-list') {
    return (
      <svg {...common}>
        <g stroke="currentColor" strokeWidth="1.5" fill="none">
          <rect x="2.75" y="14.75" width="8.5" height="10.5" />
          <rect x="15.75" y="14.75" width="8.5" height="10.5" />
          <rect x="28.75" y="14.75" width="8.5" height="10.5" />
          <path d="M11.5 18h4M13.5 16l2 2-2 2M24.5 18h4M26.5 16l2 2-2 2M15.5 22h-4M13.5 20l-2 2 2 2M28.5 22h-4M26.5 20l-2 2 2 2" />
        </g>
      </svg>
    )
  }
  if (slug === 'digraph') {
    // Four nodes, five one-way edges; each arrowhead is drawn at the edge's end, short of the target node.
    const edges: [number, number, number, number][] = [[7, 12, 27, 7], [27, 7, 33, 27], [7, 12, 13, 32], [13, 32, 33, 27], [7, 12, 33, 27]]
    return (
      <svg {...common}>
        {edges.map(([x1, y1, x2, y2]) => {
          const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len
          const ex = x2 - ux * 4.5, ey = y2 - uy * 4.5 // stop at the node's rim
          const bx = ex - ux * 3.5, by = ey - uy * 3.5
          return (
            <g key={`${x1}${y1}${x2}${y2}`}>
              <line x1={x1} y1={y1} x2={bx} y2={by} stroke="currentColor" strokeWidth="1.4" />
              <path d={`M${ex} ${ey}L${bx - uy * 2.2} ${by + ux * 2.2}L${bx + uy * 2.2} ${by - ux * 2.2}Z`} className="fill-foreground" />
            </g>
          )
        })}
        <circle cx="7" cy="12" r="3.5" className="fill-primary" />
        <circle cx="27" cy="7" r="3" className="fill-foreground" />
        <circle cx="13" cy="32" r="3" className="fill-foreground" />
        <circle cx="33" cy="27" r="3" className="fill-foreground" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="6.75" y="6.75" width="26.5" height="26.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  )
}
