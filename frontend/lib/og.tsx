import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { PRODUCT } from '@/lib/brand'
import { SITE_URL } from '@/lib/server-api'

// Share cards (og:image) for the home page, a task and a run. They are drawn by next/og, which knows no CSS
// variables, so the colours below copy the light theme's tokens from globals.css.
export const OG_SIZE = { width: 1200, height: 630 }
export const OG_TYPE = 'image/png'

export const C = {
  bg: '#ffffff', // --background
  fg: '#101828', // --foreground
  muted: '#475467', // --muted-foreground
  border: '#e4e7ec', // --border
  primary: '#2a3fb8', // --primary
  secondary: '#f2f4f7', // --secondary
}

// Inter (OFL) as WOFF, latin + cyrillic: agent names and Russian titles must render. public/ ships with the
// standalone build, so the files are read from there.
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 700 }[]> | null = null
function loadFonts() {
  fonts ??= Promise.all(
    (['latin', 'cyrillic'] as const).flatMap((subset) =>
      ([400, 700] as const).map(async (weight) => ({
        // One family per subset: under one name next/og takes the first file of a weight and misses the other's glyphs.
        name: subset === 'latin' ? 'Inter' : 'Inter Cyrillic',
        weight,
        data: await readFile(join(process.cwd(), 'public/og', `inter-${subset}-${weight}.woff`)),
      })),
    ),
  )
  return fonts
}

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a3d"/><stop offset="1" stop-color="#e0245e"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="#101828"/><path d="M6 24V7.4c0-1 1.2-1.5 1.9-.8L12.5 11h7l4.6-4.4c.7-.7 1.9-.2 1.9.8V24a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" fill="url(#f)"/><circle cx="11.5" cy="16" r="1.7" fill="#101828"/><circle cx="20.5" cy="16" r="1.7" fill="#101828"/><path d="M12.75 19.75h6.5M16 17.5v5q0 2 2 2h.75" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
const MARK_URI = `data:image/svg+xml;base64,${Buffer.from(MARK).toString('base64')}`

// The card: brand on top, the content, the site's address at the bottom. maxAge is how long crawlers may keep it:
// a run's card changes while it runs.
export async function card(content: React.ReactNode, maxAge = 3600) {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', padding: '56px 64px', background: C.bg, color: C.fg, fontFamily: 'Inter, "Inter Cyrillic"' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK_URI} width={48} height={48} alt="" />
          <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>{PRODUCT}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, marginTop: 40 }}>{content}</div>
        <div style={{ display: 'flex', fontSize: 24, color: C.muted }}>{SITE_URL.replace(/^https?:\/\//, '')}</div>
      </div>
    ),
    { ...OG_SIZE, fonts: await loadFonts(), headers: { 'Cache-Control': `public, max-age=${maxAge}` } },
  )
}

// A screenshot from the API as a data URI (next/og fetches nothing itself here: the API is internal).
export async function apiImage(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${process.env.API_URL ?? 'http://127.0.0.1:8080'}/api/v1${path}`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? 'image/jpeg'
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  } catch {
    return null
  }
}
