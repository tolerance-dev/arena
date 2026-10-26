import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/server-api'

// Crawlers read the pages, not the API; share images live next to the pages (opengraph-image), outside /api.
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: ['/api', '/my', '/admin', '/login'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
