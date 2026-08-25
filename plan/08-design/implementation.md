# Design implementation — pass 1

**Shipped 2026-08-24.** Implements `design-system.md`.

## Token layer
`src/app/globals.css` — class-based theming via `@custom-variant dark`, driven by `next-themes`. One token set, two value sets. Every text pair measured at WCAG AA or better (script in `/tmp` was throwaway; the ratios are recorded in the spec table).

Base font size dropped 14px → 13px. Reps compare many records at once; vertical space is the scarce resource.

## New primitives
`button` (4 variants, loading state that doesn't change width) · `field` (Input/Select/Textarea/Field, invalid states that don't rely on colour alone) · `badge` + `Dot` · `panel` + `DetailField` · `table` (TableShell/Th/Tr/Td with hover, selected, tabular numerals) · `empty-state` (icon + what-this-is + what-to-do + action) · `avatar` (deterministic hue per person, separately tuned for each theme) · `stat-tile` · `callout` (icon rides with colour so meaning survives greyscale) · `theme-toggle` (three-state: light / dark / system).

## Screens rebuilt
- **Overview** — was five identical grey boxes. Now four stat tiles, a horizontal bar chart of open pipeline by stage, a 14-day leads area chart, and a "Needs you now" queue of the oldest untouched leads.
- **Leads** — status tabs, search with an inline icon, and an age chip that goes amber at the SLA target and red at escalation. The queue now reads as urgency rather than a list.
- **Pipeline** — stage headers carry count, value, and a share-of-pipeline bar; cards show company, value, and an owner avatar.
- **Contacts / Companies** — avatars, linked names, right-aligned tabular counts.
- **Auth** — real card treatment instead of a bare box.
- **Activity timeline** — connected rail with per-type icons; the log form is a segmented control, because logging a call is the most repeated action in the app and should cost one click.

## Charts
Recharts. Both charts are **single-series on purpose**, so identity never rests on colour and no legend is needed — the panel title names the series. Colours are CSS custom properties, so charts re-theme with the app rather than needing their own palette. Grid lines recessive, no animation on first paint, tooltips on both.

## Three bugs this pass surfaced
1. **`Date.now()` during render.** Server Components are render functions; reading the clock in one is impure and React's lint caught it. Age is now computed in the services (`listLeads`, `getDashboard`) and passed down as a number — which is where it belonged anyway.
2. **Components across the RSC boundary.** `NavLink` is a Client Component and was being handed Lucide icon *components* as props. Elements serialise; functions do not. It now takes a rendered `ReactNode`.
3. **A careless regex.** The token rename swept `\bborder-border\b`, which also matches inside `border-border-subtle` — producing `border-border-subtle-subtle` in 13 places. Caught and repaired.

## Pass 2 — interactions (2026-08-24)

**Drag-and-drop pipeline.** `@dnd-kit` rather than native HTML5 drag: it gives keyboard dragging and screen-reader announcements for free, and the board is the signature interaction of a CRM — it should not be mouse-only. The move is optimistic (`useOptimistic`), so the card lands instantly and the server either confirms it or the revalidate snaps it back. A 6px activation distance keeps a click on a card a click, not a micro-drag. The source card stays in place at 30% opacity while a `DragOverlay` follows the cursor, so columns do not reflow under the pointer.

**Command palette (⌘K).** `cmdk`, searching leads, contacts, companies, and deals in one query, plus jump-to routes when the box is empty. Debounced at 180ms — a query per keystroke would scan four tables per character. A visible `⌘K` affordance sits in the sidebar, because a shortcut nobody knows about does not exist.

**Toasts.** `sonner`, restyled onto our tokens so a confirmation never arrives in a different visual language to the page that raised it.

Both `Decimal` values crossing to the client are stringified first — Prisma `Decimal` is not serialisable across the RSC boundary.

### Caught in this pass
- **`setState` inside an effect.** Clearing search hits on a short term was a synchronous setState in an effect. Now derived (`visibleHits`), which also stops stale results flashing while the query is retyped.

## Pass 3 — the anti-slop pass (2026-08-24)

Driven by `plan/07-research/ui-craft-and-ai-tells.md`, which named 33 checkable tells with sources. What the audit found in our own code, and what changed:

| Tell | Found in our code | Fix |
|---|---|---|
| Tailwind indigo as accent (their P0) | accent was literally `#4f46e5` | Petrol teal `#0E6E7D` / `#4FC3D1`, in the same cool family as the neutrals |
| "The 1px ring on everything" | `Panel`, `StatTile`, `TableShell` all `rounded-lg border border-border-subtle bg-surface shadow-sm` | Borderless by default; separation via a measured L\* step (3.9 light / 6.0 dark) |
| Untinted neutrals, pure white | surface was `#ffffff`, neutrals near-grey | Cool-tinted ramp hue ~215; `#FAFBFC` / `#0A0D11`, no pure black or white |
| Missing tracking | caps at 0.04em, body at 0 | Full table applied as `.t-*` utilities: caps 0.075em, display −0.022em, small text +0.01em |
| Graduated weight ladder | 400/500/600 medium-semibold steps | Three separated weights, 400 / 510 / 590 |
| Uniform maximum rounding | one `lg` token used broadly | Radius by role: 3 / 5 / 8 / 11px, containers most, controls less |
| Shadow anarchy | two ad-hoc recipes | Three, tied to z-position; dark uses the L\* step, not a black shadow |
| Accent flood | accent on every table link | `RecordLink` — foreground weight + hover underline. Budget is ~2 uses/screen |
| Consumer density | 36px rows | 32px, the compact tier |
| **Only the populated state exists** | **no `loading.tsx` anywhere** | 10 route-level skeletons in the real geometry |

### Made mechanical
`scripts/check-design.mjs`, wired into CI as `npm run check:design`. Nine rules: banned indigo/violet hexes, banned Tailwind accent *and* neutral utilities, max-rounding, trust gradients, pure black/white, decorative hover-scale, placeholder copy, placeholder image CDNs. Verified by planting five violations and watching it exit 1 — a guard that has never failed proves nothing.

### Deliberately not chased
The research explicitly clears bento grids (0.1% of complaints), glassmorphism (0.2%), mesh backgrounds, and dark mode itself as low-signal. It also warns that the *escape* from Inter — cream plus a serif display plus deep emerald — is now its own tell, so the accent choice is anchored to a stated reason rather than to what looks nice this quarter.

## Not done
- Inline edit, saved views, bulk actions.
- Dialog primitive — specced, not built.
- Reordering *within* a stage (cards drop to the top of the target column).
- Connections page and notifications list use the new tokens but keep their original layout.
- **Nobody has looked at this in a browser yet.** Every route returns 200 and the CSS and chart bundles are confirmed present, but rendering is not verified visually.
