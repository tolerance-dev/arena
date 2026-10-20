# Design reference: Product Hunt × Linear

Measured on 2026-10-20 with Playwright (Chromium 140), viewports 1440×900 and 390×844, `prefers-color-scheme: light`.
Every number below was read from `getComputedStyle` / `getBoundingClientRect` on the live pages, unless it is
marked **(derived)** — those are our own decisions, not extracted values.

Pages:

- Product Hunt — https://www.producthunt.com/categories/ai-code-editors
- Linear — https://linear.app/

Access notes:

- Product Hunt answers headless Chromium with a Cloudflare interstitial (`403`, title "Just a moment…").
  The page was measured in a regular headed Chrome window instead (status `200`, no challenge shown). No
  bot-detection was bypassed.
- linear.app is dark-only: it ignores `prefers-color-scheme: light`. Light-theme values for Linear were therefore
  **not** extractable; our light palette comes from Product Hunt's measured gray scale, our dark palette from
  Linear's.

## 1. Product Hunt (structure and UX)

### Layout

| What | Measured |
| --- | --- |
| Page container | `max-width: 1216px`, padding `32px` → content 1152px, starts at x=144 at 1440 |
| Header | height 84px + border-bottom; row padding `20px 0`; white |
| Main column / sidebar | list column 740px (x 144–884), sidebar 380px (x 916–1296), gutter 32px |
| H1 → stats → description → chips → list | 173 → 254 → 357 → 473 → 540 (y, px) |
| Mobile (390) | single column, 16px side padding, burger + logo + 2 header buttons, sidebar dropped below |

### Typography (font: system stack `-apple-system, system-ui, Segoe UI, Helvetica, Arial`)

| Role | size / line-height / weight | count on page |
| --- | --- | --- |
| Body / list text | 14/24 w400 | 218 |
| Emphasis in lists | 14/24 w500, w600 | 84, 44 |
| Meta (dates, counts) | 12/20 w400 | 73 |
| Item names, section headings | 16/24 w600 | 35 |
| Section heading (FAQ) | 18/28 w600 | 1 |
| H1 | 48/56 w600, `#101828` | 1 |
| Header nav links | 16/24 w600, `#344054` | — |

### Colour (light)

| Token-like role | Value | Usage count |
| --- | --- | --- |
| Heading text | `rgb(16,24,40)` `#101828` | 33 |
| Text strong | `rgb(33,41,60)` `#21293c` | 96 |
| Body text | `rgb(52,64,84)` `#344054` | 136 |
| Secondary text | `rgb(71,84,103)` `#475467` | 61 |
| Tertiary / meta | `rgb(102,112,133)` `#667085`, `rgb(152,162,179)` `#98a2b3` | 1, 13 |
| Page | `#ffffff` | — |
| Panels, chips | `rgb(249,250,251)` `#f9fafb` | 31 |
| Hover fill | `rgb(242,244,247)` `#f2f4f7` | — |
| Border | `rgb(234,236,240)` `#eaecf0` (2px ×105, 1px ×15) | 120 |
| Border on hover | `rgb(208,213,221)` `#d0d5dd` | — |
| Link hover | `rgb(41,112,255)` | — |
| Brand accent | `rgb(255,97,84)` (their coral — **not reused**) | 21 |

### Shape and depth

- Radius: `9999px` ×55 (all buttons, chips, pills), `12px` ×41 (logos 48×48, panels), `8px` ×11, `6px` ×7, `4px` ×11.
- Shadows are rare: `0 1px 2px rgba(0,0,0,.05)` (buttons), `inset 0 0 0 1px #d0d5dd` (tag pills).

### Components

- **Stat panel**: `bg #f9fafb`, radius 12, 3 columns, label 12/20 w400, value 14/24 w600.
- **Category chip**: `bg #f9fafb`, pill, padding `6px 12px`, 14/24 w600 `#475467`; hover → filled brand colour.
- **Tag pill**: 24px high, padding `0 12px`, inset 1px ring `#d0d5dd`; hover → `bg #f2f4f7`.
- **Product row** (no borders between rows, ~32px vertical rhythm): 48×48 logo (radius 12) · name 16 w600 ·
  tagline 14/24 · rating row · topic links 14 `#475467` separated by `·` · tag pill. Award badges on the right.
- **Sidebar** blocks: heading 16 w600, compact items (40px icon, name 14 w600, tagline 12/20, time right-aligned
  12px), full-width outline button "See all…" (44px, 2px `#eaecf0` border, hover border `#d0d5dd` + `bg #f9fafb`).
- **Filter / sort**: text buttons 14 w500 with an icon, padding `6px 12px`, no border.
- **Breadcrumbs**: 14/24 `#21293c`, chevron separators, hover → blue.
- Transitions: 150ms `cubic-bezier(.4,0,.2,1)` on colour/background/border.

## 2. Linear (visual language)

### Layout

| What | Measured |
| --- | --- |
| Header | 73px, `border-bottom: 1px rgba(255,255,255,.08)`, transparent bg |
| Container | `max-width: 1436px`, padding `0 77px` (header) / content block 1344px |
| Nav items | 32px high, padding `0 12px`, pill radius, 13/19.5 w400 |
| App mock sidebar items | 208×28, padding `0 7px`, radius 8, gap 8, 13px w510 |
| Section label (sidebar) | 12/14 w510, `#62666d` |

### Typography (font: `Inter Variable`, mono `Berkeley Mono`)

| Role | size / line-height / weight / tracking | count |
| --- | --- | --- |
| Body | 14/24 w400 | 172 |
| UI text | 13/19.5 w400 and w510, `-0.13px` | 48 + 23 |
| Lead | 15/24 w400, `-0.165px`; 18/28.8 w400 | 48, 20 |
| Small | 12/14–16.8 w400 / w510 | 55 + 45 + 37 |
| Tiny (mono ids) | 10/14 w400, `-0.15px` | 16 |
| Card title | 20/26.6 w590, `-0.24px` | — |
| Section H2 | 48/48 w510, `-1.056px` (−0.022em) | 7 |
| H1 | 64/64 w510, `-1.408px` (−0.022em) | 1 |
| Inline code | 12/20 mono, padding `0 6px`, radius 4, 1px border, faint fill | — |

Weights are variable-font values 400 / 510 / 590 — never 700+. Large type is tracked tight (−0.022em), UI text
slightly tight (−0.01em).

### Colour (dark only)

| Role | Value | count |
| --- | --- | --- |
| Page | `#08090a` | — |
| Panel / card | `#0f1011` | 34 |
| Raised | `#161718`, `#2e2e32` | — |
| Text primary | `#f7f8f8` | 21 |
| Text secondary | `#d0d6e0` | 105 |
| Text tertiary | `#8a8f98` | 180 |
| Text quaternary | `#62666d` | 132 |
| Border default | `rgba(255,255,255,.08)` | 268 |
| Border strong | `rgba(255,255,255,.12)` | 44 |
| Hover fill | `rgba(255,255,255,.08)` (nav), `.02` (sidebar rows) | — |
| Label colours | red `#eb5757`, blue `#4ea7fc`, green `#27a644` | — |

### Shape, depth, motion

- Radius: `9999px` ×72 (nav, CTAs), `8px` ×29 (rows, buttons), `9px` cards, `4px` ×22 (chips, code), `12px` ×19
  (large containers), `6px` ×10.
- Borders are always 1px. Depth comes from layered fills, not shadows; the only button shadow is a 5-layer
  hairline: `0 0 1px rgba(0,0,0,.08), 0 1px 1px rgba(0,0,0,.07), 0 3px 2px rgba(0,0,0,.04)`.
- Issue card: 300×96, padding `8px 10px 12px 12px`, radius 9, `bg #0f1011`, `1px rgba(255,255,255,.08)`.
- Hover: colour/background only, 100–160ms `cubic-bezier(.25,.46,.45,.94)`. Nav link `#8a8f98 → #f7f8f8` plus
  8 % fill; primary CTA `#e5e5e6 → #ffffff`; footer link colour only. No movement, no scale.

## 3. What we take (derived)

| Principle | From | Our rule |
| --- | --- | --- |
| Content width | PH | 1152px content column (1200px container, 24px gutters) |
| Rows, not giant cards | PH | 48px icon tile, title 16 w600, one-liner 14, meta 12 with `·` separators |
| Breadcrumbs | PH | 13px muted links with chevrons, current page unlinked |
| Grey scale | PH (light), Linear (dark) | 4 text levels, `#eaecf0` / `#d0d5dd` borders, `#f9fafb` / `#f2f4f7` fills |
| Font | Linear | Inter (variable, cyrillic) instead of the system stack; JetBrains Mono for numbers/ids |
| Weights | Linear | 400 / 500 / 600 only |
| Size scale | both | 12 · 13 · 14 · 15 · 16 · 20 · 28px; h1 never above 28px (24 on phones) |
| Tracking | Linear | −0.011em UI, −0.02em headings |
| Borders | Linear | always 1px; depth from fills |
| Radius | Linear | 4 (chips, code), 6 (controls), 8 (cards, rows), 12 (large frames); pills only for counters |
| Hover | Linear | fill/colour only, 120ms; no lifts, scale or glows |
| Header | Linear + PH | 56px, 1px bottom border, 13px nav items with pill hover fill |
| Accent | own | the existing signal blue `#2753db`, used for primary actions, links, focus and selection only |

Explicitly not taken: Product Hunt's coral brand colour, logos and copy; Linear's dark marketing hero, gradients and
product mock-ups. Also not taken, per CLAUDE.md ("don't overload"): Product Hunt's stat panels, sidebars and filler
blocks. Pages keep their own composition; the references set the visual language and the list density only.

## 4. Raw data

The scripts and raw JSON dumps lived in the session scratchpad (`research.mjs`, `detail.mjs`, `*.json`); they are
not committed. Re-run with Playwright to refresh the numbers.

## 5. Product Hunt home and product page (2026-10-20, second pass)

Measured the same way (headed Chrome, 1440 / 1024 / 390). Pages: https://www.producthunt.com/ and
https://www.producthunt.com/products/claude-code.

### Layout

| What | 1440 | 1024 | 390 |
| --- | --- | --- | --- |
| Header | 85px, search pill 216×40, nav 16px w600, pill buttons 40px | same | 58px, burger + logo + Sign in |
| Columns | main 900px (x 114) + aside 280px (x 1046), gutter 32px | one column 992px, aside moved below the feed | one column 358px, aside below |
| Left sidebar | **none** on home, category or product pages | none | none |
| H1 | 24/32 w600 `#101828` | 24/32 | 20/30 |

### Feed row (home)

- Section 932×110, padding 16px, radius 12; hover fills `#f2f4f7` (300ms `cubic-bezier(0,0,.2,1)`), no border.
- 48×48 thumbnail, radius 12. Title "1. Name" 16/24 w600 `#101828` (turns brand colour on hover); tagline 16/24 w400
  `#344054`; topic row 14/24 w400 with a tag icon and `·` separators.
- Right: two 52×52 counters (comments, upvotes): white, `2px #eaecf0` border, radius 12, icon over number 16px;
  hover changes the border to the brand colour only. On phones only the upvote box stays.
- Sections are stacked feeds ("Today", "Yesterday", "Last week", "Last month"), each with its own 24px heading.

### Product page

- Header: 64×64 logo (radius 8) + H1 24/32 w600 + tagline 18/28 w400 `#344054` + rating/meta line 14px; "Visit website"
  pill 44px (`2px #eaecf0`, hover `#f9fafb` + `#d0d5dd`) on the right.
- Category links 14px with `·`, description 16/24, then pill tabs: 40px high, radius 9999, active `bg #eaecf0`,
  inactive text `#475467`, counts in grey pills (`bg #f9fafb`, 14px w600).
- Media carousel: 432×220 images, radius 12. Then sections (18/28 w500 headings) with feed rows.
- Aside 280px: actions as icon + 16px text links, then small info blocks (16px w600 headings) and "Similar products".

### Mapping to Tolerance (proposal, not built)

| Product Hunt | Tolerance |
| --- | --- |
| Product (feed row) | Challenge (task): glyph or best screenshot as thumbnail, title, tagline, limits as topics |
| Upvote counter | Best score; comment counter → number of submissions. Real votes do not exist in the API |
| Product page | Challenge page: header, pill tabs Submissions / Brief / Results, aside with limits |
| Launch (row on product page) | Submission (run): screenshot card, agent, score, checks, live preview |
| Maker profile | Agent page: `/api/v1/agents/{id}` + `/api/v1/runs?agent=` |
| Leaderboards | Standings (exists on the home page today) |
| Categories / topics / search | Nothing to back them: 3 tasks, no category field, no search endpoint |
