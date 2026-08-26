# Design v2 — database character

- **Status:** Pass 1 shipped 2026-08-24 — awaiting the owner's eyes
- **Mandate from the product owner:** all four wrong (colour, type, layout, looks broken) · reference = **Notion / Airtable** · **too cramped, open it up** · **rip it up and redo it**

## What I got wrong the first time

I read "dense B2B power tool" out of the research and built a *terminal*: 13px text, 32px rows, a petrol-teal accent, cool-grey neutrals, and — worst — I stripped borders off every surface because "the 1px ring on everything" is a named AI tell.

That last move was actively wrong for this brief. In a **database** UI the light borders *are* the design: they're the grid. Removing them left panels floating with nothing but a 4 L\* background step to define them, which in dark mode was almost nothing at all. That is very likely a large part of "looks broken/unfinished".

Three specific reversals:

| v1 decision | v2 decision | Why |
|---|---|---|
| Cool-tinted neutrals (hue ~215) | **Warm** neutrals, ink `#37352F` | Cool greys read clinical. The reference is warm near-black on white. |
| Borderless surfaces, separation by lightness step | **Light borders as structure**, `#E9E9E7` | A grid needs grid lines. This is what a database looks like. |
| 13px / 32px rows / compact | **14px / 40px rows / roomier** | Owner says cramped. Fewer records per screen is the correct trade here. |

## Palette

Warm neutrals, near-white page, one blue used sparingly, and **colour confined to tags**. Every pair below measured AA or better — Notion's own tertiary grey (`#8B8781`) and blue (`#2383E2`) do *not* clear 4.5:1, so those are darkened rather than copied.

| Token | Light | Dark |
|---|---|---|
| page | `#FFFFFF` | `#191919` |
| surface | `#FFFFFF` | `#202020` |
| sunken (headers, hover) | `#F7F6F3` | `#1A1A1A` |
| hover | `#F1F0EE` | `#2A2A2A` |
| border | `#E9E9E7` | `#2F2F2F` |
| border-strong | `#DDDCD9` | `#3D3D3D` |
| ink | `#37352F` | `#D4D4D4` |
| ink-2 | `#6B6862` | `#9B9B9B` |
| ink-3 | `#726D63` | `#8D8D8D` |
| accent | `#1667B8` | `#5E9FE0` |

**Tags are the only colour.** Nine pairs (gray, brown, orange, yellow, green, blue, purple, pink, red), each a pastel background with a darker text tone, all AA. Lead status, deal outcome, task urgency and role all become tags rather than bespoke semantic colours.

## Type — wider range, not more steps

The v1 ramp was six steps inside 10–26px, which is why nothing stood out. v2 keeps three weights but widens the range and raises the floor.

| Step | Size / line-height | Weight | Tracking |
|---|---|---|---|
| display | 30 / 1.15 | 600 | −0.02em |
| title | 20 / 1.3 | 600 | −0.012em |
| heading | 15 / 1.4 | 590 | −0.006em |
| body | **14** / 1.55 | 400 | 0 |
| label | 13 / 1.45 | 510 | 0.006em |
| caps | 11 / 1.4 | 560 | 0.07em |

## Density
Base 14px · table rows **40px** · cell padding `10px 12px` · panel padding 20px · page gutter 32px · section gap 24px.

## Shape and depth
Radius 4px on almost everything, 6px on dialogs. **No shadows on static surfaces** — depth is borders and the sunken tone. Shadow only on things that genuinely float: dialogs, popovers, the bulk bar.

## Structural fixes ("looks broken")
1. **Sticky table headers — got this wrong twice.**

   *The original bug:* the page header and every table header were both `sticky top-0`, so the table header slid under the page header on scroll.

   *My first fix made it worse:* I set the table header to `top: var(--header-h)` (52px). But `TableShell` wraps the table in `overflow-x-auto`, and `overflow-x: auto` forces `overflow-y` to compute to `auto` — so **that div is the scrollport, not the page**. A 52px top offset inside a box with no vertical scroll shoves the header row 52px down permanently, over the first rows. Every table in the app was visibly displaced.

   *The actual fix:* the grid scrolls inside its own region — `max-h` + `overflow-auto` on the wrapper — and the header is `top-0` relative to that scrollport. Sticky headers now work, and the page header can never collide with them because the table never scrolls past it.

   The lesson: `position: sticky` resolves against the nearest scrollport, and any `overflow` value other than `visible` on either axis creates one. Verified after the fix: zero elements carry a header-height offset, and 11 sticky headers sit at `top-0`.
2. **Dark panels had neither border nor shadow**, leaving only a lightness step. Borders are back.
3. Cell padding and row height were fighting (`h-8` against `py-1.5`); row height is now set by padding alone.

## Shipped in pass 1
Tokens, type scale, density, tags, table grid, panels, stat tiles, sidebar, nav items, page gutters, board columns, dialog, empty states. 32 files migrated off the v1 token names.

Verified: all 11 routes return 200; compiled CSS carries `font-size: 14px`, `--ink: #37352f` / `#d4d4d4`, `--border: #e9e9e7` / `#2f2f2f`, `--header-h: 52px`; 37 vertical cell rules render on the contacts grid; tags render from the pastel palette; the sticky conflict is gone — table headers now sit at `top-[var(--header-h)]` and only page headers remain at `top-0`. 229 tests, lint, build and design guard all clean.

## Pass 2 — navigation and account (2026-08-24)

Owner feedback: settings were "displayed in 1 frame in the menu", and "the profile click is below and the logout is not standard". Both were fair.

**Settings were four rows in the main nav.** Team, Pipelines, Organization and Connections sat beside the records a rep uses all day. Settings are visited rarely and belong behind their own section. There is now **one** `Settings` entry, and `/settings` is a real section with its own chrome header and a tab row — General / Members / Pipelines / Connections. `/settings` itself redirects to the first tab rather than being an empty landing page. The broken-connection count still surfaces, on both the sidebar entry and the Connections tab, because a lost lead is worth interrupting for.

A tab row rather than a third sidebar: the app already has a 248px nav, and three columns for four rarely-visited pages is the worse trade.

### Correction: the account belongs top-right, not in the sidebar

The first attempt put a combined workspace-and-account dropdown at the **top of the left sidebar**. That is Notion's pattern, and Notion was the stated reference — but Notion is the *exception*. Airtable, Gmail, GitHub, Stripe, Vercel, Linear, Salesforce and HubSpot all put the account avatar **top-right**, and that is what people look for.

The underlying cause was that this app had no top bar, so the account had nowhere else to go. Fixed by pinning it into the same 52px band as each page's header — so the row reads as one app bar: page title left, page actions, account far right. Page headers reserve the space with `pr-20`.

The sidebar top is now plain workspace identity: initial plus name, not a control. The trigger is the avatar alone, since an identity control does not need to repeat a name that is already inside the menu it opens.

**Superseded — the original problem was that the account was a bare "Sign out" text link at the bottom.** No comparable product does that. Identity now sits at the **top** of the sidebar as a single trigger — org initial, org name, user email, chevron — opening one menu holding the avatar and email, the role, Settings, Members, an Appearance row with the theme switch, and Sign out in danger tone. One place to look for "things about me" instead of four scattered rows plus a stray button.

The theme switch moved into that menu. It was a permanent three-button control taking space in the sidebar for something people set once.

**New primitive: `Menu`.** Follows the menu-button keyboard contract — Enter/Space/ArrowDown opens and focuses the first item, arrows move, Home/End jump, Escape closes and returns focus to the trigger, Tab closes, pointer-down outside closes. It registers on the overlay stack, so ⌘K cannot open on top of it and Escape resolves against the menu rather than the page. ArrowUp on the first item returns to the trigger instead of wrapping, because wrapping in a short menu feels like a trap.

**A second stacked-header bug, caught before shipping.** Each settings page carried its own sticky `PageHeader`, which under the new settings layout would have produced two chrome bars — the same displaced look as the sticky table headers. Settings pages now use `SectionHeader`, a plain in-flow heading, and the layout owns the only sticky bar. Verified: one header-height element per settings page.

The design guard also caught `rounded-full` on the 2px tab indicator. Rather than add an exemption, it uses the radius token — at 2px the difference is invisible, so the rule did not need bending.

## Pass 3 — layout and legibility (2026-08-24)

Owner: *"everything is on the left side of the screen"*, *"increase the size of tables"*, *"the kanban is too small and too cramped"*, and settings should live only in the account menu.

- **Nothing was centred.** Ten constrained containers used `max-w-*` with **zero** `mx-auto` anywhere in the app, so every page hugged the left edge and left dead space on a wide monitor. All page columns are now centred, and list pages are capped at 1280px rather than stretching to the full monitor.
- **Tables enlarged** — cell padding 10px → 12px vertical, 12px → 16px horizontal, giving ~46px rows.
- **Kanban widened** — columns 248px → 320px, cards 12px → 16px padding, deal titles 14px → 15px, owner avatars 18px → 22px, and the column ground is now sunken so cards read as sitting *in* a column rather than floating beside each other.
- **Minimum text size raised.** 44 places still used 10–11px against a 14px base — below the floor this system defines, and a real contributor to "cramped". Nothing is under 12px now.
- **Settings left the sidebar entirely.** It is reached from the account menu. I initially kept a conditional "Fix connections" entry there for abandoned imports; the owner asked for it gone, so the sidebar is now records only. The count still shows on the Connections tab inside settings, and dead-lettered imports still notify admins — the signal is not lost, it just does not live in the nav.

### A process failure worth recording
Two of the pass-2 board edits **silently did not apply** — the column width and the sunken ground — because the string-replace did not match, and I reported the pass as complete without checking those specific classes had landed. The board stayed at 248px through a change I had described as shipped. Any edit made by string substitution has to be verified by grepping for the *new* value, not by the absence of an error.

## Pass 4 — inline cell editing (2026-08-25)

"Everything editable in place" is the core of the reference aesthetic, and it was the biggest remaining gap. Built from the mechanics in `plan/07-research/crm-ui-mechanics.md` rather than invented.

**Two-state focus, per the W3C ARIA grid pattern.** "Soft focus" — which cell is highlighted and arrow-navigable — is kept as *separate state* from edit mode. Collapsing them is what makes home-grown grids feel wrong: arrow keys start typing, Escape closes the page instead of the editor, Tab escapes the table.

Keys: arrows move and clamp at the edges · Home/End jump to row ends · Enter and F2 enter edit mode · any printable character enters edit mode **seeded with that character**, so typing over a cell just works · Escape reverts and returns focus to the grid, not the body · Enter commits and drops to the cell below · Tab commits and moves along the row.

**The identity column navigates instead of editing** — clicking a contact's name opens the record; every other cell edits. That branch is the single most copyable mechanic in the research and it is why a name column that opens a record does not feel inconsistent with a table you can type into.

**Grid hotkeys yield to the overlay stack**, so arrow keys do nothing while a dialog is open.

### A bug that verification caught
Every cell rendered at `tabindex="-1"` and none at `0`, which meant **Tab skipped the entire grid and it was unreachable by keyboard**. Roving tabindex needs exactly one tab stop; with nothing focused yet there was none. The first cell now holds it until focus moves. Verified in the rendered output: 1 cell at `0`, 11 at `-1`.

Writes reuse the same `saveFieldAction` as the record page, so the field allowlist and the ownership rule apply unchanged — a grid cell is not a wider write path than a form. 5 tests cover that specifically.

## Pass 5 — header and sidebar identity (2026-08-25)

**The page bar had three faults.**
1. A 15px title stacked over a 13px description inside a **fixed 52px** band — about 39px of text in 52px of bar, so it clipped and the page title was the same size as a panel heading. Now `min-h-56px` with a real 18px/590 title, and the bar grows rather than squeezing when a page carries a description.
2. `pr-20` was a magic number compensating for the account control being `position: fixed`.
3. **The header and the content beneath it were centred within different widths** — the bar inside `viewport − sidebar − gutter`, the content inside `viewport − sidebar` — so the title never quite lined up with the table under it. Found by reading the containers, before it was reported.

Fixed structurally: the account control now renders **inside the page bar**, in the same centred `max-w-[1280px]` container as the content, with a rule separating page actions from it. No fixed positioning, no gutter token. `PageHeader` became a Server Component that resolves the user itself; the session behind it is request-cached, so it costs one extra select.

**Sidebar identity.** Was a flat grey square holding a letter — identical for every organisation. Now a tile coloured from the org's own name, with the role beneath it, sitting in the same band as the page bar so the two line up across the divider. The hue function is shared with `Avatar` in `src/lib/hue.ts`, because two components deriving colour independently is how the same name ends up in two shades.

**Nav icons** are muted until their row is active or hovered, so a column of seven icons stops competing with the one that matters. Search moved to the same 14px scale as the rest of the sidebar.

## Pass 6 — the record composer (2026-08-26)

Owner: the add-activity form "looks like an open form, it looks messy".

**It was two open forms, stacked.** A record page rendered an activity form — a four-button type selector, a subject input and a three-row textarea — directly above a task form with its own title, date and assignee. Roughly nine visible controls competing with the timeline the page exists to show.

**Nobody does this.** From `plan/07-research/crm-ui-mechanics.md`: Salesforce's docked composer has an explicit **Closed** state and Email / Log a Call / New Task tabs above the timeline; Attio puts New note and New task behind header actions with `n` and `t` shortcuts; Close puts a single composer in the centre column. The form appears when you mean to write something.

**Now one collapsed control** reading "Log a call, email or note — or add a task", which expands into a tabbed composer: Note · Call · Email · Meeting · Task. The Task tab absorbed the separate task form entirely, so adding a follow-up and logging a call are the same motion in the same place.

Details worth keeping: the relevant field is focused the moment a tab opens, so opening and typing is one gesture; `Cmd/Ctrl+Enter` submits from anywhere in the form and `Escape` closes without saving — the two shortcuts people try first; and the composer collapses again after a successful save rather than sitting open.

Verified in the rendered page: **0 visible inputs or textareas** while closed, down from about nine, and no tablist in the DOM until it is opened.

The standalone `AddTaskForm` is still used on `/tasks`, where an always-visible add row is right — that page is a list you are working through, not a record you are reading.

## Still to do
- **Charts** still use the accent for their single series. Against a white page with a blue accent that may read as generic; a tag hue might sit better.
- **Record detail pages** keep the two-column layout. In a database aesthetic these are usually a stacked page with a properties block at the top.
- **No inline cell editing in tables.** The reference is "everything editable in place"; today only record pages have click-to-edit.
- Avatars are still a coloured-initials circle. Notion uses these too, but the hue set should come from the tag palette rather than a hash across the whole wheel.
- **Record detail layouts** are still the two-column app shape rather than a stacked properties page.
- ~~No inline cell editing in tables~~ — **shipped 2026-08-25** for contacts (title, email, phone). See below.
- The design guard has no rule for the v2 decisions — it still bans indigo, but nothing stops someone reintroducing a shadow on a static surface or a cool-grey.

## Not changing
Tenant scoping, services, tests, the design guard, and the modal/interception architecture. This is a surface and density rebuild, not a rewrite of behaviour.
