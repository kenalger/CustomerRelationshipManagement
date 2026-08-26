# Design system

- **Status:** Approved 2026-08-24
- **Direction:** theme-switchable (light + dark, neither an afterthought), Linear/Attio register — borders over shadows, one confident accent, dense but breathable.

## Why the first pass failed
Flat tables, plain-text nav, five identical grey boxes, no icons, no charts, no hierarchy. Everything had the same visual weight, so nothing guided the eye. A CRM is stared at all day by someone under quota pressure; it must answer "what needs me now?" before it is read.

## The four decisions (written down so the mean does not reassert itself)

Generated UI drifts to the centre of the distribution when nothing states a direction. These four are stated, with reasons, and three of them are machine-enforced by `npm run check:design`.

| Decision | Value | Reason |
|---|---|---|
| **Reference density** | Linear / Attio — compact tier, 32px rows | A rep sits in this six hours a day and compares many records at once. Consumer whitespace is the opposite of what they need. |
| **Accent** | Petrol teal — `#0E6E7D` light, `#4FC3D1` dark | **Not indigo or violet.** Tailwind indigo is the single most reliable signature of generated UI, and the previous accent was literally `#4f46e5`. Teal sits in the same cool family as the neutrals. |
| **Neutrals** | Cool-tinted ramp, hue ~215, low saturation. Never `slate`/`zinc` out of the box, never pure `#000`/`#fff`. | Cool neutrals read as competence and order, which is what a revenue tool wants. Pure black and white vibrate. |
| **Type** | One variable face (Geist) at three separated weights — 400 / 510 / 590 | Weight should jump, not step. Two faces would be defensible; a five-step ladder reads as a default scale. The serif-display escape route is itself a tell now. |

## 1. Colour tokens

Contrast measured, not estimated. Every pair below is **WCAG AA (≥4.5:1)** for body text.

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--canvas` | `#F6F7F9` | `#0B0D11` | Page ground |
| `--surface` | `#FFFFFF` | `#12151B` | Cards, tables, panels |
| `--surface-raised` | `#FFFFFF` | `#181C24` | Dialogs, popovers, hover rows |
| `--border-subtle` | `#E4E7EC` | `#232833` | Default dividers |
| `--border-strong` | `#CDD2DA` | `#333A48` | Inputs, focus-adjacent |
| `--text-primary` | `#10141C` | `#E8EAED` | 18.4:1 / 15.2:1 |
| `--text-secondary` | `#5A6472` | `#9BA3B0` | 6.0:1 / 7.2:1 |
| `--text-tertiary` | `#6C7583` | `#78818F` | 4.7:1 / 4.6:1 — the floor |
| `--accent` | `#4F46E5` | `#7C8CFF` | 6.3:1 / 6.1:1 |
| `--accent-hover` | `#4338CA` | `#93A0FF` | |
| `--accent-fg` | `#FFFFFF` | `#0B0D11` | On accent fills: 6.3:1 / 6.5:1 |
| `--accent-muted` | `rgb(79 70 229 / .08)` | `rgb(124 140 255 / .14)` | Selected rows, active nav |
| `--success` | `#067647` | `#34D399` | 5.7:1 / 9.5:1 |
| `--warning` | `#B54708` | `#FBBF24` | 5.4:1 / 11.0:1 |
| `--danger` | `#D92D20` | `#F87171` | 4.8:1 / 6.6:1 |
| `--info` | `#175CD3` | `#60A5FA` | 6.0:1 / 7.2:1 |

Each semantic colour also gets a `-muted` background at 8% (light) / 14% (dark) opacity of itself. Higher opacity in dark because low-alpha fills disappear against a dark ground.

**Rule:** semantic colour carries meaning only. Nothing is coloured for decoration — if a rep sees red, something is wrong.

## 2. Type

`Geist Sans` (already loaded), `Geist Mono` for ids and payloads.

| Step | Size / line-height | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 28 / 34 | 600 | -0.02em | Dashboard hero figure only |
| `title` | 18 / 24 | 600 | -0.01em | Page heading |
| `heading` | 14 / 20 | 600 | -0.005em | Panel and section headings |
| `body` | 13 / 1.5 | 400 | +0.01em | **Base.** Table cells, prose. Small text needs air. |
| `label` | 12 / 16 | 500 | 0 | Form labels, buttons |
| `caption` | 11 / 14 | 500 | 0.04em, uppercase | Column headers, stat labels |

13px base, not 16: reps compare many records at once and vertical space is the scarce resource. `font-variant-numeric: tabular-nums` on every number that sits in a column or gets compared — money, counts, dates, percentages.

## 2b. Separation escalates — the rule that replaces the 1px ring

A border around every card is the other big tell: when everything is ringed, nothing recedes and nothing advances. Separate two surfaces in this order, cheapest first:

1. **Whitespace** — costs no ink.
2. **A background lightness step.** Measured: **3.9 L\*** between canvas and surface in light, **6.0 L\*** in dark. This is the move almost nobody makes and the one that does the work.
3. **Shadow** — only when the element genuinely floats. Three recipes total, tied to z-position.
4. **Border** — last resort, or when it carries meaning.

`Panel` is therefore **borderless by default** with `bordered` as an opt-in. A coloured edge is reserved for semantic state (`ring-1 ring-danger/25` on an alerting stat tile); decoratively, a coloured left border on a rounded card is the canonical generated-dashboard tile and it is banned.

## 2c. Accent budget

Roughly **two visible accent uses per screen**. Spent on: the active nav indicator (orientation) and the primary action. Everything else is neutral — which is why record names in tables use `RecordLink` (foreground weight + underline on hover) rather than a blue link. A table of twenty accent-coloured links spends the budget twenty times over.

## 3. Space, radius, border

4px scale: `0.5/1/1.5/2/3/4/6/8/12` → 2…48px. Table cell padding `8px 12px`. Panel padding `16px`. Page gutter `24px`.

Radius: `sm 4px` (badges, inputs), `md 6px` (buttons, rows), `lg 8px` (cards, panels), `xl 12px` (dialogs). Border `1px` everywhere.

## 4. Elevation

Light uses shadow; dark cannot — a black shadow on a dark ground is invisible, so dark expresses depth with a **lighter surface plus a stronger border**.

| Level | Light | Dark |
|---|---|---|
| flat | border-subtle | border-subtle |
| raised | `0 1px 2px rgb(16 20 28 / .06)` | surface-raised + border-subtle |
| overlay | `0 8px 24px rgb(16 20 28 / .12)` | surface-raised + border-strong |

## 5. Components

- **Button** — `primary` (accent fill), `secondary` (surface + border), `ghost` (transparent, hover surface), `danger`. Sizes `sm 28px` / `md 32px`. States: hover, active, disabled (50%, no pointer), loading (spinner replaces leading icon, label stays so width does not jump).
- **Input / Select / Textarea** — 32px, surface, `border-strong`, radius `sm`. Focus: 2px accent ring offset 1px. Invalid: danger border + message below, never colour alone.
- **Badge** — 20px, radius `sm`, 11px/500, semantic muted bg + semantic fg + 1px border of the same hue at 25%.
- **Panel** — surface, border-subtle, radius `lg`, 16px pad. Header row: `heading` left, actions right.
- **Table** — header `caption` on canvas, sticky. Rows 36px, border-subtle between. Hover `surface-raised`. Selected `accent-muted` + 2px accent left border. Numbers right-aligned and tabular. Never horizontal page scroll — the table scrolls inside its own container.
- **Sidebar nav item** — 32px, icon 15px + label. Active: `accent-muted` bg, accent text, 2px accent left bar. Badge right-aligned.
- **Stat tile** — `caption` label, `display` value, delta chip, and a sparkline. A number with no trend is not worth a tile.
- **Empty state** — icon, one-line what-this-is, one-line what-to-do-next, and the action button. Never just "No data".
- **Command palette** — ⌘K, fuzzy over records and actions.
- **Focus** — `:focus-visible` 2px accent outline, 2px offset, on everything interactive. Never removed.

## 6. Icons

`lucide-react`, 15px in nav and buttons, 14px inline, `strokeWidth 1.75`.

Overview `LayoutDashboard` · Notifications `Bell` · Leads `Sparkles` · Pipeline `KanbanSquare` · Contacts `Users` · Companies `Building2` · Connections `Plug` · Search `Search` · New `Plus` · Convert `ArrowRightLeft` · Retry `RefreshCw` · Healthy `CheckCircle2` · Broken `AlertTriangle` · Sign out `LogOut`.

## 7. Screens

**Dashboard** — replaces five identical boxes. Row of stat tiles with sparklines (pipeline value, weighted forecast, new leads, avg. response time), then two columns: pipeline-by-stage bar chart + "needs you now" queue of unworked leads. A manager should diagnose the week in five seconds.

**Leads** — status tabs with counts, search, saved-view chips. Rows show an SLA age chip that turns amber then red. Bulk select for assign/convert.

**Pipeline** — stage columns with count and value in the header, drag-and-drop cards, deal card shows company, value, owner avatar, and an age indicator.

**Record detail** — two columns: sticky identity + fields left, activity timeline with inline composer right.

**Connections** — status-first: big health chip, event counts as a small bar, error collapsed by default.

## 8. Charts

Recharts. Categorical series use accent → teal → amber → violet → rose, in that order. Sequential uses accent at 20/40/60/80/100% opacity. Grid lines `border-subtle`, no chart junk, no 3D, no pie charts with more than four slices. Every axis labelled; every chart answers one stated question.

## 8b. States — the definition of done

Aesthetics were never the biggest gap; state coverage was. A CRM lives in the empty state (new tenant, no leads yet), the error state (a Meta connection has failed), and the edge state (10k leads, every optional field blank).

Every list, table, form and panel needs all five: **loading, empty, error, populated, edge.** `loading.tsx` exists for every heavy route with a skeleton in the *final geometry* — a centred spinner tells you nothing and makes the layout jump when content lands. Empty states carry a headline, an explanation, and an action; never "No data". Error is never rendered as empty.

Still missing: a 15-second "taking longer than usual" fallback, retry backoff in the UI layer, and a 10,000-row table check.

## 9. Motion

150ms `ease-out` for hover and colour, 200ms for popovers, 250ms for drawers. Theme switching does **not** animate — a whole page cross-fading reads as a glitch. Respect `prefers-reduced-motion`: keep opacity, drop movement.

## Where an action goes: the app bar is not a toolbar

*Added 2026-08-26 after "New contact" was found sitting beside the account avatar.*

Two bands, two jobs, and they must not be merged:

| | Holds | Changes per page? |
|---|---|---|
| **App bar** (`<PageHeader>`) | Page title, description, notifications, account | Only the title |
| **Page toolbar** (`<PageToolbar>`) | Search, filters, tabs, and the page's own actions | Entirely |

`PageHeader` deliberately takes **no** `action` prop. It is not an oversight and it should not be added back: the row is identical on every screen, so anything in it reads as belonging to the application. A "New contact" button there sits next to the avatar and the eye has no way to separate a page action from app furniture.

This is the line the mature design systems draw:

- **Salesforce (SLDS)** — the *global header* carries only what "persists with the user through their experience": search, favourites, help, setup, notifications, avatar. There is no create button in it. A *page header* is a **separate component**, "distinguished from the global header through its focus on page-specific content and actions". ([SLDS global-header](https://raw.githubusercontent.com/salesforce-ux/design-system/master/ui/components/global-header/docs.mdx), [page-headers](https://raw.githubusercontent.com/salesforce-ux/design-system/master/ui/components/page-headers/docs.mdx), read 2026-08-26)
- **Atlassian** — "A page header defines the top of a page. It contains a title and can be optionally combined with breadcrumbs, buttons, search, and filters." The buttons sit **with** the search and filters, not in the app chrome. ([Atlassian page header](https://atlassian.design/components/page-header/examples), read 2026-08-26)
- **HubSpot** does put a create in its top bar — but it is a **global** "+ Quick Create" that makes a contact, company, deal, ticket or task *from anywhere*. That is app furniture, not a page's primary action, and it is a different thing from "New contact" on the contacts list. ([HubSpot navigation guide](https://knowledge.hubspot.com/help-and-resources/a-guide-to-hubspots-navigation), read via `plan/07-research/crm-ui-mechanics.md` §4.9)

**Practical rule:** the action belongs directly above the thing it acts on, on the same row as the controls that narrow it. If you are reaching for an `action` prop on `PageHeader`, you want `PageToolbar`.
