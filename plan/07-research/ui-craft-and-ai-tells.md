# Research: UI craft vs. "AI slop" — the nameable tells and their fixes

- **Researched by:** ui-craft-research
- **Date:** 2026-08-24
- **Confidence:** High on the tells (multiple independent sources converge on the same list, several with code-level signatures). High on craft numbers where a source states them explicitly. Medium on anything I have flagged inline, and Low on the quantitative prevalence claims (single-vendor datasets, methodology not published).

## Question

The product owner has twice called our CRM UI "AI slop". I need the *specific, nameable* tells — the ones you can point at in a diff — and the concrete fix for each. Not "add whitespace", not "use a design system". Then: what actual craft looks like, with numbers, so the fixes are checkable rather than tasteful.

## Executive summary — the three root causes

Everything below reduces to three mechanics, and they are worth naming separately because they need different fixes.

1. **Defaults were never overridden.** shadcn/ui is "explicitly designed to be copy-pasted by AI agents" ([Developers Digest, *AI Design Slop: 16 Patterns*](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), pub. 2026-04-22, upd. 2026-06-10, read 2026-08-24). The tell is not shadcn or Tailwind — it is `components.json` with `baseColor: "slate"` and `--radius: 0.5rem` unedited ([Claude Code HQ, *Unslop UI*](https://www.claudecodehq.com/playbooks/unslop-ui), mid-2026, read 2026-08-24). Their data explicitly clears the tools and indicts the defaults.
2. **No decision was made, so the model reached for the mean.** "The real cause of slop is no decision — when nothing tells the agent which direction to commit to, it falls back on the safe, high-probability look" ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). LLMs compute a weighted average of every interface in training, so output trends to the centre of the distribution ([SmoothUI, *AI Design Slop*](https://smoothui.dev/blog/ai-design-slop), pub. 2026-06-24, read 2026-08-24).
3. **Only the happy path was drawn.** "The single most reliable AI-design failure is shipping only the populated state" ([OpenDesign `craft/state-coverage.md`](https://github.com/nexu-io/open-design/blob/main/craft/state-coverage.md), read 2026-08-24). This one matters most for us — a CRM is mostly *not* the populated state.

For a **B2B sales CRM specifically**, there is a fourth, and it is probably what our product owner is actually reacting to: the default AI aesthetic is a consumer-marketing aesthetic. "The visual styling of a consumer app — generous whitespace, large typography, minimal information density — is the opposite of what most B2B power users need. They sit in front of your product for hours. They know it well. They want to work fast, not be guided gently." ([Designpixil, *B2B SaaS UI Design Principles*](https://designpixil.com/blog/b2b-saas-ui-design-principles), upd. May 2026, read 2026-08-24)

---

## Part 1 — The tells, and the fix for each

Each is nameable, checkable in a diff, and sourced. Grouped for navigation, numbered continuously so you can reference them.

### Surfaces, cards, borders

**1. "The 1px ring on everything" — every card is `rounded-lg border bg-card shadow-sm`, so nothing recedes and nothing advances.**
The repeated trio `rounded-lg border bg-card text-card-foreground shadow-sm` is the single most-cited code signature of default shadcn ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). Described elsewhere as "soft white backgrounds, muted gray text, cards with `rounded-xl` and a 1px ring" ([Slicer.dev, *Why AI-generated UI all looks the same*](https://slicer.dev/blog/why-ai-generated-ui-looks-the-same), pub. 2026-04-27, read 2026-08-24).
**Fix:** default cards to **borderless**, and escalate separation in this order: whitespace first → a **3–5% background-lightness shift** → soft elevation. Only then a border ([VibeCodeKit, *AI Slop Design*](https://vibecodekit.dev/ai-slop-design), 2026, read 2026-08-24). Refactoring UI's rule is the same: "use fewer borders" — replace with spacing, background colour, or a subtle box-shadow ([Refactoring UI skill notes](https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md), read 2026-08-24).

**2. The coloured left-border accent strip on a rounded card — "the canonical AI dashboard tile".**
Named as a P0 cardinal sin: "Rounded card with a colored left-border accent — the canonical 'AI dashboard tile' shape. Drop either the radius or the left border." ([OpenDesign `craft/anti-ai-slop.md`](https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md), read 2026-08-24). Independently: coloured borders on left/top edges, "typically in purple or blue", are called "almost as reliable a sign of AI-generated design" ([Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), read 2026-08-24).
**Fix:** reserve coloured borders for **semantic state only** (overdue, at-risk, error). If it is decoration, delete it. If you keep the strip, lose the radius ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design); [OpenDesign anti-ai-slop](https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md), read 2026-08-24).

**3. "Cardocalypse" — nested cards inside cards.**
Named directly; fix given as "use whitespace and bg shifts instead" ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24).
**Fix:** one card boundary per region. A panel inside a panel becomes a background shift plus a heading. Where a nested surface genuinely exists, use the concentric radius formula (Part 2, §Radius) so it doesn't read as a mistake.

**4. Uniform maximum rounding — one radius token reused everywhere, buttons at `rounded-full`.**
Code signature: `rounded-2xl` / `rounded-3xl` broadly on cards and containers, `border-radius: 9999px` on every button ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24).
**Fix:** define a **small radius scale** and apply it by element role, not globally. "Not everything needs maximum rounding. Sharp or lightly-rounded corners often read more deliberate." ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24) For a data tool: containers get the largest radius, controls get less, table cells get none.

**5. "Everything is a card" — a card grid used where a table or list belongs.**
"Most card implementations are lazy. Teams default to cards because it's the safe choice, not because it's the right one." Cards "de-emphasize ranking and hierarchy, making them poor for search results, data tables, or settings pages" ([Stan Vision, *UI Card Design*](https://www.stan.vision/journal/ui-card-design-examples-best-practices-and-common-patterns), pub. 2026-03-23, upd. 2026-07-23, read 2026-08-24). Cards fail on dense datasets because the user's job is scanning, comparing and sorting many rows of similar data; forcing that into cards produces vertical overload and fragments relationships the user is trying to see (same source).
**Fix:** match the primitive to the intent — **cards for browsing mixed content, lists for scanning uniform records, tables for comparing.** The test the article gives: "Next time you reach for a card grid, ask yourself one question: would a list work better here?" For a CRM, leads/deals/contacts/activities are all *compare* surfaces — they are tables, not card grids.

**6. Shadow anarchy — every component has its own shadow recipe.**
"Each component uses a different shadow recipe", so depth cues behave decoratively rather than systematically ([Managed Code, *AI Slop in Design*](https://www.managed-code.com/blog-post/ai-slop-in-design), pub. 2026-03-02, read 2026-08-24).
**Fix:** cap at **3 or fewer shadow recipes on core surfaces** ([Managed Code](https://www.managed-code.com/blog-post/ai-slop-in-design), read 2026-08-24). Refactoring UI's fuller ladder is 5 levels tied to z-position (Part 2, §Elevation) — 3 is the pragmatic floor for an app of our size. Shadow means "floats above" (menu, popover, modal); it is never decoration on a static panel.

### Colour

**7. Tailwind indigo/violet as the accent — the single most reliable tell.**
Flagged as a P0 lint failure against an explicit hex list: `#6366f1`, `#4f46e5`, `#4338ca`, `#3730a3`, `#8b5cf6`, `#7c3aed`, `#a855f7`. "Indigo is the textbook AI tell." ([OpenDesign `craft/anti-ai-slop.md`](https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md) and [`craft/color.md`](https://github.com/nexu-io/open-design/blob/main/craft/color.md), read 2026-08-24). Corroborated with the same hexes plus "CSS vars at HSL hue ~255–280" ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24), and "when a model can't decide on a color, it reaches for `indigo-600` or `slate-900` because those tokens appear in roughly a billion tutorials" ([Alan West, DEV](https://dev.to/alanwest/how-to-fix-the-ai-generated-look-in-your-frontend-1ahh), pub. 2024-05-18 — **older than 24 months, dated**, read 2026-08-24).
**Fix:** pick a non-violet/indigo accent, or if purple is genuinely the brand, use a specific off-default purple paired with a **non-default neutral ramp** ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). Enforce it: replace Tailwind's `colors` **entirely rather than extending**, so a build failure forces compliance ([Alan West](https://dev.to/alanwest/how-to-fix-the-ai-generated-look-in-your-frontend-1ahh), read 2026-08-24).

**8. Accent flood — the brand colour appears a dozen times on one screen.**
"The single biggest readability failure in AI-generated UIs is accent overuse." Hard cap: **at most 2 visible uses of `--accent` per screen**; links count as accent; hover/focus rings count as accent ([OpenDesign `craft/color.md`](https://github.com/nexu-io/open-design/blob/main/craft/color.md), read 2026-08-24). The lint threshold is `var(--accent)` used 6+ times in the rendered body ([anti-ai-slop](https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md), read 2026-08-24).
**Fix:** budget the accent. One primary CTA plus one status/eyebrow use. Demote links to foreground colour with an underline when a CTA is on the same screen ([color.md](https://github.com/nexu-io/open-design/blob/main/craft/color.md), read 2026-08-24). Everything else is neutral. Pixel budget: neutrals 70–90%, accent 5–10%, semantic 0–5%, effects <1% (same source).

**9. The two-stop "trust" gradient — purple→blue, blue→cyan, indigo→pink.**
Second-most-reliable tell after indigo, called out at P0 ([OpenDesign `craft/color.md`](https://github.com/nexu-io/open-design/blob/main/craft/color.md), read 2026-08-24). Code signature: `bg-gradient-to-* … bg-clip-text text-transparent`, `from-purple-* to-blue-*` ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24).
**Fix:** default to solid fills; at most **one** restrained gradient as an accent, with analogous low-contrast stops; **never gradient a heading or paragraph text** ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). Gradients may separate hierarchies (header→body) but must not decorate empty space ([color.md](https://github.com/nexu-io/open-design/blob/main/craft/color.md), read 2026-08-24).

**10. Pure `#000` / `#fff`, and untinted neutrals.**
"Avoid pure black and pure white — both cause vibration and eye strain." Prescribed swaps: dark bg `#0f0f0f` not `#000`, dark fg `#f0f0f0` not `#fff`, light bg `#fafafa` not `#fff`, light fg `#111111` not `#000` ([OpenDesign `craft/color.md`](https://github.com/nexu-io/open-design/blob/main/craft/color.md), read 2026-08-24).
**Fix:** those four values, plus commit to a neutral **temperature** (next tell).

**11. No colour temperature decision — greys are whatever `slate` happened to be.**
Warm neutrals sit at hue 0–70°, cool at 180–270°; Tailwind `slate` and `zinc` are cool-neutral, `stone` and `warm` lean warm ([ColorArchive, *Neutral Color Palettes*](https://colorarchive.org/guides/neutral-color-palettes/), read 2026-08-24 — **no publication date on the page**). "Developer tools, analytics dashboards, design applications, productivity software, data platforms, and financial services all benefit from cool neutral palettes because the coolness communicates competence and order" (same source).
**Fix:** for a sales CRM, a **cool neutral ramp is the defensible choice** — but it must be a *chosen* cool ramp with its own hue and saturation, not `slate` out of the box. Tint every neutral toward one hue and keep the accent in the same temperature family (same source). Linear made exactly this move in reverse: they *reduced* the blue in their theme calculation "for a more neutral and timeless appearance" ([Linear, *How we redesigned the Linear UI (part II)*](https://linear.app/now/how-we-redesigned-the-linear-ui), pub. 2024-03-28, read 2026-08-24).

**12. Unprompted neon glow and glassmorphism.**
Glow signature: `shadow-[0_0_*]`, large coloured `box-shadow`/`text-shadow`, `drop-shadow-[0_0_*]`, bright `text-cyan-400`/`text-fuchsia-400` on `bg-slate-950` ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). "Glassmorphism with a neon glow" is one of four tells SmoothUI names outright ([SmoothUI](https://smoothui.dev/blog/ai-design-slop), read 2026-08-24). Glassmorphism is one of the two dominant CSS fingerprints alongside shadcn defaults ([Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), read 2026-08-24).
**Fix:** delete unprompted glow. "Dark mode relies on contrast and spacing, not glow." On dark surfaces use a 1px `rgba(255,255,255,0.08)` border rather than a solid dark border or a glow ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui); [color.md](https://github.com/nexu-io/open-design/blob/main/craft/color.md), read 2026-08-24). Note both sources rate glassmorphism itself as **low-signal** (0.2% of complaints) — do not over-rotate on it.

### Typography

**13. Inter (or Geist) as the only face, at default tracking and default line-height.**
"Inter font used universally with minimal variation, default line-height and letter-spacing — technically readable and entirely forgettable" ([Alan West](https://dev.to/alanwest/how-to-fix-the-ai-generated-look-in-your-frontend-1ahh), read 2026-08-24). Signature: `next/font/google` importing one face with no second face; Tailwind `font-sans` left at default with no custom config ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). Setting `font-family: system-ui` alone on a heading is called "the textbook AI default" ([OpenDesign `craft/typography.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography.md), read 2026-08-24).
**Fix:** two faces maximum, display + body, or **one variable face used at deliberately separated weights** ([typography.md](https://github.com/nexu-io/open-design/blob/main/craft/typography.md), read 2026-08-24). Linear's actual move: Inter Display for headings, regular Inter for body ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui), read 2026-08-24). **Caution:** the escape route is also a tell — `Instrument Serif`, `Fraunces`, `Playfair Display`, `Spectral`, `Cormorant`, `DM Serif` are now the "tasteful default" ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24), so don't swap one autopilot pick for another.

**14. ALL-CAPS labels with no positive tracking, and display text with no negative tracking.**
"This is the single most-skipped rule in AI-generated design. No exceptions… ALL CAPS without positive tracking looks cramped and amateur. Display text without negative tracking looks loose and weak. These two failures are the most reliable AI-slop tells." ([OpenDesign `craft/typography.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography.md), read 2026-08-24)
**Fix:** the full table is in Part 2, §Tracking. Minimum viable: ALL CAPS `0.06em`–`0.1em`; headings 32px+ `-0.01em` to `-0.02em`; display 48px+ `-0.02em` to `-0.03em`; small text 11–13px `+0.01em` to `+0.02em`. Never negative on body text — "negative tracking at text sizes is one of the most common amateur typography mistakes".

**15. All-caps section labels used as the *only* hierarchy device.**
Listed as one of the 16 patterns ([Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), read 2026-08-24); the given fix is "use weight hierarchy instead" ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24).
**Fix:** all-caps is a *tertiary* device (metadata, column headers, chip labels). If every panel is topped by a tracked-out all-caps eyebrow, the eyebrows are carrying hierarchy that scale and spacing should carry.

**16. The graduated weight ladder — regular → medium → semibold → bold → extrabold, one step per level.**
"Reads as a default scale, not authored hierarchy. **Weight should jump, not step.**" ([OpenDesign `craft/typography-hierarchy.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography-hierarchy.md), read 2026-08-24)
**Fix:** three weights only — Read (400/450) for body, Emphasize (510/550) for UI text and labels, Announce (590/600) for headings and buttons. "Weight 700+ is rarely needed. If your design uses bold for 'emphasis on emphasis', it likely lacks weight discipline elsewhere." ([typography.md](https://github.com/nexu-io/open-design/blob/main/craft/typography.md), read 2026-08-24)

**17. Flat hierarchy — three levels at 18/20/22px, so the surface reads as a wall.**
Named as one of the two hierarchy failure modes, with the exact example "scale steps that are too close (e.g. 18 / 20 / 22 px for three levels)", plus "weight used only once" and "uniform spacing between all elements" ([OpenDesign `craft/typography-hierarchy.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography-hierarchy.md), read 2026-08-24).
**Fix:** adjacent levels **≥1.25× apart in scale, or compensated by a weight or spacing jump**; no two adjacent levels may share the same scale, weight *and* spacing; **at least two hierarchy vectors** (scale, weight, spacing, tracking, alignment) must be active on the dominant element (same source). And: no more than **three type sizes visible above the fold** ([typography.md](https://github.com/nexu-io/open-design/blob/main/craft/typography.md), read 2026-08-24).

**18. Size-only hierarchy — all contrast lives in font-size; weight, spacing, tracking and alignment are uniform.**
Listed as an anti-pattern and called "fragile — any layout constraint that collapses the size contrast destroys the hierarchy" ([OpenDesign `craft/typography-hierarchy.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography-hierarchy.md), read 2026-08-24). Related: "heading as the only hierarchy vector — the heading is large and bold, everything else is flat. The heading does all the work" (same source).
**Fix:** use the three-tier colour/weight/size model together (Part 2, §Hierarchy levers). Spacing alone can promote an element to display level without changing its size — "an isolated element with large surrounding space reads as display-level regardless of its font size" (same source).

### Layout, composition, rhythm

**19. "Icon + heading + muted subtitle" repeated in every panel — the identical feature-card row.**
"Six identical cards in a row, each with an icon, a heading, and two lines of text" ([SmoothUI](https://smoothui.dev/blog/ai-design-slop), read 2026-08-24). Independently measured as "identical feature cards with icons — repetitive icon-on-top card layout", present on 22% of pages sampled ([Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), read 2026-08-24 — **prevalence figure is a single-vendor dataset, methodology unpublished; treat as directional**). Also "exactly 3 feature cards in a row (reflex)" ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24).
**Fix:** either vary card treatment, or commit to one primitive repeated consistently — the failure is the middle ground ([Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), read 2026-08-24). In an app (as opposed to a landing page) the stronger fix is to delete the icon and the subtitle: a panel in a working tool needs a label, not a sales pitch. Also: "huge centered Lucide icon above heading — size icons to visual hierarchy" ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24).

**20. Uniform section spacing — every gap is the same token, so spacing carries no information.**
"Uniform section spacing — every section gap is the same value. No hierarchy information is carried by spacing." and "uniform spacing between all elements destroys spatial hierarchy" ([OpenDesign `craft/typography-hierarchy.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography-hierarchy.md), read 2026-08-24). Also named as "monotonous spacing everywhere" ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24).
**Fix:** the proximity ladder — **space inside a component < space between components < space between sections** ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24); "more space around a group than within it" ([Refactoring UI notes](https://www.joelsleppy.com/blog/notes-on-refactoring-ui/), read 2026-08-24). Checkable rule: at least one gap should be **≥1.5× the others**, or one full scale step apart ([typography-hierarchy.md](https://github.com/nexu-io/open-design/blob/main/craft/typography-hierarchy.md), read 2026-08-24).

**21. Off-scale arbitrary spacing — `p-3` next to `p-7`, `mt-[37px]`.**
Signature given as "mixed `p-3`, `p-7`, arbitrary `mt-[37px]`" plus "misalignment (off-by-pixels edges, inconsistent column gutters)" ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). Also "arbitrary pixel values (13px, 37px)" ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24).
**Fix:** every spacing value is a multiple of **8, with 4 as the half-step** ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24). Refactoring UI's concrete scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256px ([Refactoring UI skill](https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md), read 2026-08-24). Ban arbitrary-value Tailwind classes in lint.

**22. Perfect symmetry, everything centred, one container width for every section.**
"Perfect symmetric layout with no visual tension" is a listed polish tell; the fix given is "alternating density (one tight section, one breathing section) reads as intentional" ([OpenDesign `craft/anti-ai-slop.md`](https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md), read 2026-08-24). "Centered everything / endless whitespace" is measured as low-signal (0.2% of complaints) but the fix stands: "vary alignment, tighten spacing" ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24).
**Fix:** never centre text longer than **1–2 lines**; left-align beyond that ([Refactoring UI notes](https://www.joelsleppy.com/blog/notes-on-refactoring-ui/) and [skill](https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md), read 2026-08-24). Break the grid deliberately: asymmetric layout with content offset left, e.g. `grid-template-columns: minmax(2rem, 1fr) minmax(0, 38rem) minmax(0, 1fr)` ([Alan West](https://dev.to/alanwest/how-to-fix-the-ai-generated-look-in-your-frontend-1ahh), read 2026-08-24).

**23. The KPI stat-banner row — four tiles, big number, green up-arrow, percent delta.**
"Stat banner rows — horizontal metric displays" is one of the 16 patterns; the fix given is "integrate stats into narrative layouts" ([Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), read 2026-08-24). Independently: "gradients on large numbers 'for impact'" is a named colour tell ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24).
**Fix:** the density source has the sharper version of this — "I've watched teams pack twenty metrics into a tight grid… then pull usage analytics and find twelve of those metrics never got a single click in three months" ([Art of Styleframe, *Dashboard Data Density Patterns*](https://artofstyleframe.com/blog/dashboard-data-density-patterns/), pub. 2026-08-03, read 2026-08-24). Instrument the tiles; delete the ones nobody clicks. Never gradient the number.

**24. Consumer-app density in a power-user tool.**
The Designpixil claim in the summary above, plus the concrete anecdote: a support lead given "a beautifully spacious dashboard with generous padding and five rows visible at a time hated it — her job was scanning two hundred tickets a shift, and every extra pixel of padding meant more scrolling, more lost context, more time" ([Art of Styleframe](https://artofstyleframe.com/blog/dashboard-data-density-patterns/), read 2026-08-24).
**Fix:** ship density modes with real numbers (Part 2, §Density) and default our list views to **Standard or Compact**, not Comfortable. "The solution is progressive disclosure, not blanket whitespace." (same source)

**25. Emoji as icons; and mixed icon libraries.**
Emoji in `<h*>`, `<button>`, `<li>` or `class*="icon"` — "`✨`, `🚀`, `🎯`, `⚡`, `🔥`, `💡`" — is a P0 lint failure; the prescribed replacement is **1.6–1.8px-stroke monoline SVG with `currentColor`** ([OpenDesign `craft/anti-ai-slop.md`](https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md), read 2026-08-24). Also "sidebar/nav with emoji icons" ([Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), read 2026-08-24).
**Fix:** one icon library, one stroke width, one optical size. Lucide is drawn at **2px stroke inside a 24×24 viewBox with artwork in roughly a 22×22 live area**, and "if you're using icons at other sizes, stroke width should be adjusted accordingly to maintain visual consistency" ([Lucide stroke-width guide](https://lucide.dev/guide/lucide/basics/stroke-width), read 2026-08-24). Rendering a 24px-designed 2px-stroke icon at 16px makes it read heavier than its neighbours — use `absoluteStrokeWidth` or scale the stroke (same source). Mixing libraries is described as "the single most common reason an interface feels slightly unfinished" ([Lucide icons guide, ICON OOP](https://iconoop.com/lucide-icons.html), read 2026-08-24 — **secondary source, no publication date**).

### Behaviour and states

**26. Only the populated state exists — no loading, empty, error or edge state.**
"The single most reliable AI-design failure is shipping only the populated state… Missing states are the most common silent failure of AI-generated UI." Five states are required on every surface that fetches, transforms or accepts data: Loading, Empty, Error, Populated, Edge ([OpenDesign `craft/state-coverage.md`](https://github.com/nexu-io/open-design/blob/main/craft/state-coverage.md), read 2026-08-24). Corroborated: "critical states such as focus, disabled, error, empty, or loading are absent or improvised late" ([Managed Code](https://www.managed-code.com/blog-post/ai-slop-in-design), read 2026-08-24).
**Fix:** render-and-screenshot every list, table, card, form and panel in all five. The dashboard/table edge scenario is specified as **10,000+ rows, all numeric columns, sort + filter applied** ([state-coverage.md](https://github.com/nexu-io/open-design/blob/main/craft/state-coverage.md), read 2026-08-24). Full state and threshold tables in Part 2, §States.

**27. "Something went wrong" — error with no cause and no recovery, and a form that clears on failure.**
Both named as lint failures ([OpenDesign `craft/state-coverage.md`](https://github.com/nexu-io/open-design/blob/main/craft/state-coverage.md), read 2026-08-24).
**Fix:** every error answers three questions in order — **what happened, why (if knowable), what the user can do.** Preserve user input across the error; the form must not clear on submit failure. Match severity to scope (field / form / section / page / app) — a field validation failure does not warrant a page-level error (same source).

**28. Empty state is a literal blank or the words "No data".**
Named as a lint failure; "Empty is not the absence of state. It is its own state with a job." Four distinct kinds are specified: first-use, no-results, cleared, and **error-as-empty — never** ([OpenDesign `craft/state-coverage.md`](https://github.com/nexu-io/open-design/blob/main/craft/state-coverage.md), read 2026-08-24).
**Fix:** headline + plain explanation + primary CTA at minimum. First-use empty is the onboarding moment. No-results empty echoes the query and suggests alternatives (same source).

**29. Animation spam — the same fade-up on every element, `hover:scale-105` on every card.**
Signature: `initial={{ opacity: 0, y: 20 }}` / `whileInView` / `whileHover={{ scale: 1.05 }}` repeated, `data-aos="fade-up"` everywhere ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). "A bounce on every hover" ([SmoothUI](https://smoothui.dev/blog/ai-design-slop), read 2026-08-24). Also "hover states that do nothing" as the inverse failure ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24).
**Fix:** motion only for state communication or spatial reorientation — "the exception, not the wrapper". Honour `prefers-reduced-motion` ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). Durations in Part 2, §Motion. Note the strong claim behind this: a 2002 IJHCS meta-analysis found every study claiming animation aids comprehension had a broken control; the only endorsed use case is real-time spatial or temporal reorientation ([OpenDesign `craft/animation-discipline.md`](https://github.com/nexu-io/open-design/blob/main/craft/animation-discipline.md), read 2026-08-24).

**30. Barely-passing (or failing) contrast, especially on dark surfaces and muted secondary text.**
Named: "barely-passing contrast — dark themes with body text failing WCAG AA" ([Developers Digest](https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it), read 2026-08-24). "AI-generated UI is often unusable with missing focus states, contrast that fails WCAG" ([SmoothUI](https://smoothui.dev/blog/ai-design-slop), read 2026-08-24). CHI 2025 research is cited for AI assistants systematically generating inaccessible markup (same source — **I have not read the CHI paper itself; `UNVERIFIED` as a primary claim**).
**Fix:** gates not goals — body ≤16px on background **4.5:1**; large text >18px or 14px bold **3:1**; **UI components against adjacent surfaces 3:1** (that last one is the one everyone skips — it is what makes our 1px borders and disabled states legal) ([OpenDesign `craft/color.md`](https://github.com/nexu-io/open-design/blob/main/craft/color.md), read 2026-08-24). Where the brand accent is too light for text, darken to a 600-level shade for text use and reserve the bright variant for fills (same source). One source recommends APCA instead, targeting **Lc ≥75 body, ≥45 large/bold, ≥30 UI** ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24).

**31. Invented metrics and filler copy.**
"Invented metrics — '10× faster', '99.9% uptime', '3× more productive'" and "filler copy — `lorem ipsum`, `feature one / two / three`, `placeholder text`" are both P0 sins. "An empty section is a design problem to solve with composition, not by inventing words." ([OpenDesign `craft/anti-ai-slop.md`](https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md), read 2026-08-24) Also: hollow copy — "Empower your team to unlock productivity", two-word abstract nouns like "Seamless Integration" ([Alan West](https://dev.to/alanwest/how-to-fix-the-ai-generated-look-in-your-frontend-1ahh), read 2026-08-24), and clichés "Transform your X / Supercharge / Unleash" ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24).
**Fix:** ban the verbs in lint. Require at least one claim with a real number. Use realistic seed data — actual names, actual amounts, actual dates — not "Product 1" ([Alan West](https://dev.to/alanwest/how-to-fix-the-ai-generated-look-in-your-frontend-1ahh); [GenDesigns, *Why Your AI-Generated UI Looks Bad*](https://gendesigns.ai/blog/ai-generated-ui-mistakes-how-to-fix), pub. 2026-03-15 upd. 2026-08-08, read 2026-08-24). Microcopy is also where soul is cheapest: "a button that says 'Start tracking' beats one that says 'Get started'" ([anti-ai-slop.md](https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md), read 2026-08-24).

**32. Raw hex values scattered outside the token layer, and colour tokens named by hue.**
Lint threshold: **more than ~12 raw hex values outside `:root`** means "tokens were not honoured" ([OpenDesign `craft/anti-ai-slop.md`](https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md), read 2026-08-24). Separately, "orphaned design decisions… no owner at the system level" despite static polish — the symptom being that "layout resists normal change requests; spacing drifts unpredictably" ([Managed Code](https://www.managed-code.com/blog-post/ai-slop-in-design), read 2026-08-24).
**Fix:** name tokens by purpose (`--accent`, `--success`), never by hue (`--blue-500`) — hue names "lock you out of theming" ([OpenDesign `craft/color.md`](https://github.com/nexu-io/open-design/blob/main/craft/color.md), read 2026-08-24). Measurable gate: **8 of 10 sampled components map to design tokens (80% pass rate)** ([Managed Code](https://www.managed-code.com/blog-post/ai-slop-in-design), read 2026-08-24).

**33. Optically wrong details — mathematically centred glyphs, symmetric icon-button padding, mismatched nested radii.**
"Computers cannot figure out where the weight of an object lies… As designers, we need to compensate for this through something called optical adjustment" ([Marvel Blog, *Optical Adjustment — Logic vs. Designers*](https://marvelapp.com/blog/optical-adjustment-logic-vs-designers/), read 2026-08-24 — **no publication date visible**). The canonical case is a triangle/play glyph: its visual mass sits left, so it must be nudged right — "shift in the opposite direction of the visual weight" ([Rails Designer, *Mathematical and optical alignment*](https://railsdesigner.com/mathematical-optical-alignment-design/), pub. 2024-11-11, read 2026-08-24).
**Fix:** three concrete moves, all cheap: (a) icons ship with built-in safe area, so **decrease the padding on the icon side** of an icon+label button rather than padding symmetrically ([Rails Designer](https://railsdesigner.com/mathematical-optical-alignment-design/), read 2026-08-24); (b) align button content to **cap height** — equal space above and below the uppercase letter, and push all-caps text a few pixels lower ([Marvel Blog](https://marvelapp.com/blog/optical-adjustment-logic-vs-designers/), read 2026-08-24); (c) apply the concentric radius formula (Part 2, §Radius). Note these sources are explicitly directional, not numeric — "nudging values up and down by 1 pixel until it feels right" ([Marvel Blog](https://marvelapp.com/blog/optical-adjustment-logic-vs-designers/), read 2026-08-24).

---

## Part 2 — What real craft looks like, with numbers

### Type scale

Multiplicative, ratio **1.2 or 1.25**, capped at **6–8 sizes per surface** ([OpenDesign `craft/typography.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography.md), read 2026-08-24):

| Role | Range |
|---|---|
| Display | 48–72px |
| H1 | 32–48px |
| H2 | 24–32px |
| H3 | 20–24px |
| Body | 15–18px |
| Small | 13–14px |
| Caption | 11–12px |

Refactoring UI's discrete scale: 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72px ([Refactoring UI skill](https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md), read 2026-08-24).

**The competing view, and I think the right one for us:** a strict ratio is not required. A 13-step scale built by hand landed on "roughly 1.17–1.18×" through the body/UI range and 1.20–1.29× only at the top, with the explicit reasoning "the content structure drove the scale, not the mathematics" — the middle was deliberately *compressed* to stop H3 jumping ~2× off body, and the top *expanded* for display impact ([Blake Crosley, *Type Scales: How I Chose 13 Steps*](https://blakecrosley.com/blog/typography-systems), pub. 2026-02-08, read 2026-08-24). For a data-dense CRM this is the more useful posture: a 1.25 ratio through the UI range produces sizes we will never use, and a compressed 1.125–1.18 range through 12→21px is what a table-heavy product actually needs.

### Tracking (letter-spacing) — the single most-skipped rule

([OpenDesign `craft/typography.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography.md), read 2026-08-24)

| Context | Letter-spacing |
|---|---|
| Body text (14–18px) | `0` |
| Small text (11–13px) | `+0.01em` to `+0.02em` |
| UI labels and button text | `+0.02em` |
| **ALL CAPS** | **`0.06em` to `0.1em` — required** |
| Headings 32px+ | `-0.01em` to `-0.02em` |
| Display 48px+ | `-0.02em` to `-0.03em` |

The `0.06em` floor is sourced, not arbitrary: Bringhurst's *Elements of Typographic Style* §3.2.7 recommends 5–10% of the em for caps; modern screen practice rounds the lower bound to 0.06em (same source, citing Bringhurst — **I have not read Bringhurst directly**). Always use `em` so tracking scales with size. Refactoring UI is more aggressive at the top: `-0.05em` on headlines, `+0.05em` on all-caps ([Refactoring UI notes](https://www.joelsleppy.com/blog/notes-on-refactoring-ui/), read 2026-08-24).

### Line height

| Text size | Line height |
|---|---|
| Display / H1 (≥32px) | 1.0–1.2 |
| Body (15–18px) | 1.5–1.6 |
| Small (≤14px) | 1.5 |

([OpenDesign `craft/typography.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography.md), read 2026-08-24.) Refactoring UI: body 1.5–2, headings 1–1.25, large display 1 ([Refactoring UI skill](https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md), read 2026-08-24). A hand-built system used **1.7 for body** and **1.05 with `-0.03em` for an 80px display** ([Blake Crosley](https://blakecrosley.com/blog/typography-systems), read 2026-08-24).

**Note if we ever localise:** these are Latin values. CJK glyphs fill the em box, so display/H1 needs **1.3–1.4** and body **1.7–1.8**, and negative tracking must be `0` for CJK — "at 96px a 1.05 leading makes the two lines of a Chinese cover headline visibly collide" ([OpenDesign `craft/typography.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography.md), read 2026-08-24).

### Weights, and line length

Three weights: **Read 400/450, Emphasize 510/550, Announce 590/600**. 700+ rarely needed ([OpenDesign `craft/typography.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography.md), read 2026-08-24). Body copy **50–75 characters** per line, `max-width: 65ch` as a safe default (same source); Refactoring UI says 45–75 characters / 20–35em ([Refactoring UI notes](https://www.joelsleppy.com/blog/notes-on-refactoring-ui/), read 2026-08-24). Never `text-align: justify` on the web — it creates rivers ([typography.md](https://github.com/nexu-io/open-design/blob/main/craft/typography.md), read 2026-08-24).

### How many greys a mature system actually uses

- **8–9 shades of grey**, near-white to near-black, **not true black**. Numbered 50–900. ([Refactoring UI skill](https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md) and [notes](https://www.joelsleppy.com/blog/notes-on-refactoring-ui/), read 2026-08-24)
- 5–10 shades of the primary; 5–10 of each semantic (success/warning/danger/info); **40–80 colours defined upfront** total ([Refactoring UI skill](https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md), read 2026-08-24).
- Counterweight: **8 stops per colour is enough** for most systems including both light and dark modes; 10 is often more than needed and some colours only need 2–3 ([UX Collective / general colour-ramp guidance summarised via search, read 2026-08-24 — **`UNVERIFIED`, I did not fetch the primary article; treat "8 is enough" as directional**).
- Linear's own move is the strongest datapoint on restraint: they now **define a whole theme with three variables — base colour, accent colour, and a contrast value (range 30–100) — instead of 98** ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui), pub. 2024-03-28, read 2026-08-24).

**The usable answer for us:** ~9 neutral steps, 1 accent ramp, 3 semantic ramps. Roughly 40 tokens, not 400 — and the neutrals must be tinted to a chosen temperature (tell #11).

### Text colour hierarchy — exactly three levels

| Level | Font weight | Colour lightness |
|---|---|---|
| Primary | 600–700 | dark, ~10% lightness |
| Secondary | 500 | medium grey, ~45% |
| Tertiary | 400 | light grey, ~65% |

([Refactoring UI skill](https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md), read 2026-08-24). Three functional levels — Primary (entry point, one per visual region), Secondary (structure), Tertiary (labels, captions, metadata) — and "more than three visible levels above the fold is usually a composition problem, not a hierarchy opportunity. Collapse or demote before adding a fourth." ([OpenDesign `craft/typography-hierarchy.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography-hierarchy.md), read 2026-08-24)

### When shadow beats border

Escalation order for separating two surfaces, cheapest first ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24; [Refactoring UI](https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md), read 2026-08-24):

1. **Whitespace** — costs nothing, adds no ink.
2. **Background lightness shift of 3–5%** — the move almost nobody makes and the one that kills the "1px ring on everything" look.
3. **Soft elevation (shadow)** — only when the element genuinely floats.
4. **Border** — last resort, or when it carries semantic meaning.

"Borders are a great way to distinguish elements, but using too many can make your design feel busy and cluttered" ([Refactoring UI notes](https://www.joelsleppy.com/blog/notes-on-refactoring-ui/), read 2026-08-24).

**Shadow ladder** (5 levels, tied to z-position, not decoration) ([Refactoring UI skill](https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md), read 2026-08-24):

| Level | Use | Value |
|---|---|---|
| xs | buttons | `0 1px 2px rgba(0,0,0,.05)` |
| sm | cards | `0 1px 3px rgba(0,0,0,.1), 0 1px 2px rgba(0,0,0,.06)` |
| md | dropdowns | `0 4px 6px rgba(0,0,0,.1), 0 2px 4px rgba(0,0,0,.06)` |
| lg | modals | `0 10px 15px rgba(0,0,0,.1), 0 4px 6px rgba(0,0,0,.05)` |
| xl | high emphasis | `0 20px 25px rgba(0,0,0,.15), 0 10px 10px rgba(0,0,0,.05)` |

Technique: combine **one subtle larger shadow with one tighter, darker one** ([Refactoring UI notes](https://www.joelsleppy.com/blog/notes-on-refactoring-ui/), read 2026-08-24). Pragmatic cap for an app our size: **≤3 recipes on core surfaces** ([Managed Code](https://www.managed-code.com/blog-post/ai-slop-in-design), read 2026-08-24). On dark surfaces shadows don't read — use `1px rgba(255,255,255,0.08)` instead ([OpenDesign `craft/color.md`](https://github.com/nexu-io/open-design/blob/main/craft/color.md), read 2026-08-24).

### Radius — the concentric formula

**`inner radius = outer radius − padding`** (equivalently `outer = inner + padding`) ([Cloud Four, *The Math Behind Nesting Rounded Corners*](https://cloudfour.com/thinks/the-math-behind-nesting-rounded-corners/), pub. 2022-10-26, read 2026-08-24 — **older than 24 months, but this is geometry, not fashion**).

Worked: outer 24px radius with 8px padding → inner **16px**. Inner 12px with 8px padding → outer **20px**. If the result is ≤0 the inner element is square-cornered — the curve has been consumed by the spacing. In CSS: `--inner-radius: calc(var(--outer-radius) - var(--padding));` (same source; formula corroborated by [PV21 Design, *Concentric Radius*](https://pv21design.pt/concentric-radius-nested-corners-done-right/), read 2026-08-24 via search summary).

This is the single highest-leverage "optical" fix available, because a mismatched nested radius reads as sloppy to everyone and is invisible as a cause to almost everyone.

### Spacing

Scale: **4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256px** ([Refactoring UI skill](https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md), read 2026-08-24) — i.e. 8pt grid with 4 as a half-step ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24).

Rhythm rules:
- **inside component < between components < between sections** ([VibeCodeKit](https://vibecodekit.dev/ai-slop-design), read 2026-08-24)
- "more space around a group than within it"; "start with too much whitespace and take it away" ([Refactoring UI notes](https://www.joelsleppy.com/blog/notes-on-refactoring-ui/), read 2026-08-24)
- at least one gap ≥1.5× the others, or one full scale step apart ([OpenDesign `craft/typography-hierarchy.md`](https://github.com/nexu-io/open-design/blob/main/craft/typography-hierarchy.md), read 2026-08-24)
- space *above* an element signals its relationship to what came before; space *below*, to what follows (same source)

### Density and tables — the numbers that matter most for a CRM

Three density modes, with rows visible ([Art of Styleframe](https://artofstyleframe.com/blog/dashboard-data-density-patterns/), pub. 2026-08-03, read 2026-08-24):

| Mode | Row height | Rows visible | For |
|---|---|---|---|
| Comfortable | 48–52px | ~5–6 | occasional viewing, exec summaries |
| Standard | 36–40px | ~8–10 | mixed users |
| Compact | 28–32px | ~14–16 | daily power users, high-volume scanning |

28px is the practical lower bound before click targets and readability degrade (same source). A second source gives condensed 40 / regular 48 / relaxed 56px ([Pencil & Paper, *Enterprise Data Tables*](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables), pub. 2026-02-23, read 2026-08-24) — **the two sources disagree by roughly one tier**; Pencil & Paper's "condensed" is Styleframe's "standard". For a CRM used all day I would take the tighter set.

Other hard rules:
- **Cap default visible columns at 6–8** regardless of density mode; extras go behind a toggle ([Art of Styleframe](https://artofstyleframe.com/blog/dashboard-data-density-patterns/), read 2026-08-24).
- **Left-align text, right-align quantitative numbers.** "Numerical values are much easier to compare and contrast when they're right-aligned." Qualitative numbers (dates, zip codes, phone numbers) may be left-aligned; amounts and percentages never are. **Column headers must match their content's alignment.** ([Pencil & Paper](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables), read 2026-08-24)
- **Tabular/monospaced numerals** so all digits occupy equal width — this is what makes a column of deal values scannable (same source).
- **Column separators: maximum 1px, light grey only.** Vertical align centred for rows up to 3 lines, top-aligned beyond 3–4 (same source).
- **Sticky headers once a table exceeds 20–30 rows**; frozen first column when horizontal scroll exists (same source).
- Zebra stripes are one of four valid row-division strategies but are "problematic with interactive states" — line divisions are usually the better choice in an app with row hover and selection (same source).
- If text has to drop below **14px** to fit a card, the card is holding too much information ([Stan Vision](https://www.stan.vision/journal/ui-card-design-examples-best-practices-and-common-patterns), read 2026-08-24).

### Motion

Default duration is **150ms** — the convergence point across Material 3 `short3`, IBM Carbon `moderate-01`, Shopify Polaris `150`, Tailwind default and SLDS `duration-fast` ([OpenDesign `craft/animation-discipline.md`](https://github.com/nexu-io/open-design/blob/main/craft/animation-discipline.md), read 2026-08-24).

| Duration | Use |
|---|---|
| 50–100ms | instant feedback — button press, toggle, hover |
| 150ms | default, state confirmation |
| 200–300ms | entering UI — modals, sheets, dropdowns |
| 300–500ms | cross-screen transitions, container morphs |
| >500ms | cross-screen / staged / platform-native only |

Non-navigation microinteractions stay under 500ms. Frequent animations (a hover seen 50× per session) stay **≤200ms**. Curves for opacity and colour; springs for position, scale and gesture. Material 3 standard easing is `cubic-bezier(0.2, 0, 0, 1)` — the trailing zero front-loads the curve; the symmetric `cubic-bezier(0.4, 0, 0.2, 1)` is M2/legacy, and "anyone shipping the M2 curve and calling it 'M3' is on legacy tokens". Every translate/scale/rotate/parallax must respect `prefers-reduced-motion`; the View Transitions API does **not** apply it automatically. ([animation-discipline.md](https://github.com/nexu-io/open-design/blob/main/craft/animation-discipline.md), read 2026-08-24)

Linear's tactile detail worth stealing: elements scale to **0.97 on active state** ([search summary of Linear design analyses, read 2026-08-24 — **`UNVERIFIED`, I did not confirm this against Linear's own CSS**]).

### States — the full contract

Five required states on every surface that fetches, transforms or accepts data ([OpenDesign `craft/state-coverage.md`](https://github.com/nexu-io/open-design/blob/main/craft/state-coverage.md), read 2026-08-24):

| State | Must contain |
|---|---|
| Loading | skeleton/spinner/shell + a **15s "taking longer than expected"** fallback |
| Empty | headline, plain explanation, primary CTA |
| Error | plain-language cause, recovery action, **preserved user input** |
| Populated | the state the design was drawn for |
| Edge | extreme volume, long strings, missing optional fields, partial network — layout must not break |

**Loading indicator by expected duration** (same source):

| Duration | Indicator |
|---|---|
| 0–300ms | none — render synchronously |
| 300ms–2s | subtle spinner or skeleton |
| 2–10s | skeleton matched to expected layout, or a *labelled* spinner ("Loading payments…") |
| 10–30s | determinate progress bar with cancel |
| 30–60s | progress bar with explicit cancel |
| 60s+ | stop animating; show error with retry/cancel/continue |

Never leave a spinner running indefinitely; start a timeout on every request.

**Form states** add Untouched, Dirty-valid and Submitted-pending. **Validate on blur, not on first keystroke**; for live fields validate per keystroke only *after* the first blur; remove the error the instant input becomes valid. (same source)

**Retry discipline:** first retry immediate; second and third at exponential backoff 2s / 4s / 8s max; after 3 failures replace "Retry" with "Contact support" plus a **copyable error ID**; show "Last attempted: Xs ago". (same source)

**ARIA/focus:** `role="alert"` on inline submit errors + move focus to the first error field; `role="status"` for toasts, do not move focus; `role="alertdialog"` for critical/destructive, move focus to the dialog. **Live region containers must exist in the DOM before content is injected** — adding `aria-live` at the same time as the content does not announce. (same source)

### How to add character without inventing a new visual language

The ratio given is **~80% proven patterns + ~20% distinctive choice**, and the 20% should live in exactly four places: one bold visual move (a type choice, a single colour decision, an unexpected proportion); voice and microcopy; one memorable micro-interaction (a button that moves 2px, a number that counts up); and **one detail that could only have been put there by someone who used the product** — a keyboard-shortcut hint, a status badge with product-specific phrasing ([OpenDesign `craft/anti-ai-slop.md`](https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md), read 2026-08-24).

The acceptance test from the same source, which is the best single test I found: **screenshot the screen and show it to someone outside the project. If they can identify which product it's from, it has soul. If not, you shipped a template.**

For a sales CRM, the cheapest credible "someone used this" details are keyboard-first: a **Cmd/Ctrl-K command palette is "table stakes for power users"**, and it must be reachable from anywhere via a consistent shortcut, must include navigation destinations and not just records, and must show recents/frequents *before* the user types ([SaaSUI, *B2B SaaS Design*](https://www.saasui.design/blog/b2b-saas-design) and [*SaaS Navigation UX Patterns*](https://www.saasui.design/blog/saas-navigation-ux-patterns), read 2026-08-24 — **no publication dates visible on these pages**).

---

## Part 3 — The audit checklist

Run this against a screen. Each line is a pass/fail you can settle by looking at the code or the pixels. Grouped so it can be split across reviewers.

### Tokens and colour
- [ ] `components.json` `baseColor` and `--radius` have been changed from the shadcn defaults.
- [ ] No occurrence of `#6366f1`, `#4f46e5`, `#4338ca`, `#3730a3`, `#8b5cf6`, `#7c3aed`, `#a855f7`, and no accent at HSL hue 255–280.
- [ ] Tailwind `colors` is **replaced**, not extended; `indigo`/`violet`/`purple`/`fuchsia` are not reachable.
- [ ] ≤12 raw hex values outside `:root`; ≥8 of any 10 sampled components resolve colour from tokens.
- [ ] Tokens named by purpose (`--accent`, `--danger`), never by hue (`--blue-500`).
- [ ] Neutral ramp is 8–9 steps, tinted to one deliberate temperature; not stock `slate`/`zinc`.
- [ ] No `#000` or `#fff` anywhere; light bg `#fafafa`-ish, light fg `#111`-ish.
- [ ] `--accent` visible **≤2 times per screen**; links demoted when a CTA is present; focus rings counted in that budget.
- [ ] Pixel budget roughly: neutrals 70–90%, accent 5–10%, semantic 0–5%, effects <1%.
- [ ] No gradient on any heading or paragraph; at most one restrained gradient per screen; no gradient on a KPI number.
- [ ] No `shadow-[0_0_*]`, no coloured glow, no `drop-shadow-[0_0_*]`.

### Type
- [ ] ≤2 typefaces; a real fallback chain; no bare `system-ui` on a heading.
- [ ] ≤8 sizes in the scale; **≤3 sizes visible above the fold**.
- [ ] Every ALL-CAPS run has `letter-spacing ≥ 0.06em`.
- [ ] Every text ≥32px has negative tracking (−0.01 to −0.02em; −0.02 to −0.03em at 48px+).
- [ ] No negative tracking on anything ≤18px.
- [ ] Exactly 3 weights in use; no 400→500→600→700→800 ladder.
- [ ] Body line-height 1.5–1.6; headings 1.0–1.25.
- [ ] Body copy capped at 50–75 characters (`max-width: 65ch`).
- [ ] No `text-align: justify`.
- [ ] No centred text longer than 2 lines.
- [ ] Adjacent hierarchy levels differ by ≥1.25× in scale, **or** by a weight or spacing jump. No 18/20/22px trio.
- [ ] Exactly one element is unambiguously dominant per visual region; ≥2 hierarchy vectors active on it.
- [ ] No two adjacent levels share the same scale *and* weight *and* spacing.

### Surfaces
- [ ] Cards are borderless by default; separation escalates whitespace → 3–5% bg shift → shadow → border.
- [ ] Not every panel has the same radius + 1px border + `shadow-sm`.
- [ ] No coloured left/top border strip except where it encodes semantic state.
- [ ] No card nested inside a card.
- [ ] ≤3 shadow recipes on core surfaces; every shadow means "floats above", never decoration.
- [ ] Radius scale has ≥2 values applied by element role; no blanket `rounded-2xl`; no `rounded-full` on every button.
- [ ] Every nested surface satisfies `inner radius = outer radius − padding`.
- [ ] On dark surfaces, borders are `rgba(255,255,255,~0.08)`, not solid dark.
- [ ] Any surface whose job is *compare* is a table or list, not a card grid.
- [ ] No card requires text below 14px to fit.

### Layout and rhythm
- [ ] Every spacing value is on the 8pt grid (4 as half-step); zero arbitrary Tailwind values like `mt-[37px]`.
- [ ] Proximity ladder holds: inside-component < between-components < between-sections.
- [ ] Section gaps are not all identical; at least one is ≥1.5× the others.
- [ ] Not every section shares one centred container width; at least one deliberate asymmetry or density change.
- [ ] No "icon + heading + muted subtitle" block repeated across sibling panels.
- [ ] No row of 3/4/6 identical icon-topped cards.
- [ ] No oversized centred decorative icon above a heading.
- [ ] Column gutters and element edges align; no off-by-a-pixel edges.
- [ ] All-caps eyebrows are not the primary hierarchy device.

### Icons
- [ ] One icon library only.
- [ ] One stroke width, optically corrected for render size (Lucide is drawn at 2px for 24px — scale the stroke or use `absoluteStrokeWidth` at 16px).
- [ ] Zero emoji inside `<h*>`, `<button>`, `<li>`, or anything `class*="icon"`.
- [ ] Icon+label buttons have **reduced padding on the icon side**; button content aligned to cap height.

### Data and tables
- [ ] A density mode exists and the default is Standard/Compact (32–40px rows), not Comfortable.
- [ ] ≤6–8 columns visible by default; the rest behind a column toggle.
- [ ] Text left-aligned, quantitative numbers right-aligned, headers matching their column's alignment.
- [ ] Numerals are tabular/monospaced in every numeric column.
- [ ] Row dividers ≤1px light grey; no zebra striping fighting hover/selection states.
- [ ] Sticky header past ~25 rows; frozen first column where horizontal scroll exists.
- [ ] Every KPI tile on the dashboard has usage data justifying it.

### States (the highest-value section for us)
- [ ] Every list, table, form and panel has all five: loading, empty, error, populated, edge — screenshotted.
- [ ] Empty states have headline + explanation + CTA; not "No data".
- [ ] First-use, no-results and cleared empties are distinguished; error is **never** rendered as empty.
- [ ] Every error states what happened, why, and what to do.
- [ ] Forms preserve input on submit failure.
- [ ] Validation fires on blur, not first keystroke; errors clear the moment input is valid.
- [ ] No unbounded spinner; loading indicator matches expected duration; 15s "taking longer" fallback exists.
- [ ] Retry uses 2s/4s/8s backoff and degrades to "Contact support" + copyable error ID after 3 failures.
- [ ] `focus-visible`, `disabled`, `hover`, `active`, `loading` designed on every interactive component.
- [ ] Error state never conveyed by colour alone — icon or text label present.
- [ ] Toasts appear in a single consistent position; auto-dismiss pauses on hover/focus.
- [ ] Live-region containers exist in the DOM before content is injected.
- [ ] Table/list survives 10,000 rows with sort + filter applied.

### Contrast and motion
- [ ] Body text ≥4.5:1; large text ≥3:1; **UI components vs adjacent surfaces ≥3:1** (borders, disabled states, focus rings).
- [ ] Accent used for text is darkened to a 600-level shade; bright variant only for fills.
- [ ] Motion durations: 50–100ms feedback, 150ms default, 200–300ms entering UI, ≤200ms for anything seen dozens of times per session.
- [ ] No uniform fade-up/`hover:scale-105` applied across every element.
- [ ] Every translate/scale/rotate honours `prefers-reduced-motion`.

### Content
- [ ] Zero `lorem ipsum`, "Feature one", "Placeholder", "Sample content".
- [ ] Zero invented metrics ("10× faster", "99.9% uptime").
- [ ] Zero "Empower / Unlock / Transform / Supercharge / Seamless / Unleash".
- [ ] Seed and demo data is realistic — real-shaped company names, amounts, dates, owners.
- [ ] Button labels are specific to the job ("Log call", "Move to Proposal"), not "Get started".
- [ ] No external placeholder image CDNs (`unsplash.com`, `placehold.co`, `picsum.photos`).
- [ ] **The screenshot test:** someone outside the project can tell which product it is.

---

## What this means for us

1. **The fastest visible wins, in order.** (a) Replace the Tailwind colour palette outright and pick a tinted cool neutral ramp — kills tells #7, #10, #11 in one commit and is the change the product owner will notice first. (b) Add the tracking rules (#14) — a global CSS pass over all-caps and ≥32px text, near-zero risk, disproportionate perceived quality. (c) Strip the 1px border off cards and replace with a 3–5% background shift (#1) — this is the change that makes things start to recede and advance. (d) Set the table default to 32–40px rows with right-aligned tabular numerals (#24, §Density).

2. **Our biggest gap is almost certainly state coverage, not aesthetics.** A CRM lives in the empty state (new tenant, new pipeline, no leads yet), the error state (a Meta or Gmail connection has failed), and the edge state (10k leads, a 200-character company name, a deal with every optional field blank). Per `plan/07-research/meta-lead-ads-api.md`, a failed lead sync is permanent data loss — which means **connection-health error states are a launch requirement, not polish**, and they are exactly the states AI output omits. The five-state screenshot matrix should become a definition-of-done item.

3. **"Everything is a card" is our structural risk.** Leads, deals, contacts, activities and pipeline are all *compare-and-scan* surfaces. If any of them is currently a card grid, that is a stronger cause of the "slop" reaction than any colour choice, and it is the most expensive to fix later. Cards belong on the record-detail page and nowhere else.

4. **We must make four decisions and write them down, or the slop returns on the next generated component.** The four are: one reference product for density and colour; the accent (not indigo); the type pairing with a stated reason; and per-screen layout intent ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). These belong in `plan/08-design/design-system.md` as hard values, and ideally in a `DESIGN.md` the agents read.

5. **Make the rules mechanical, not aspirational.** The sources that actually change output all enforce via lint: banned regexes that fail the build (`/bg-(indigo|violet|purple)-600/`, `/rounded-(2xl|3xl)/`, `/from-purple-\d+ to-(blue|pink)-\d+/`) ([Alan West](https://dev.to/alanwest/how-to-fix-the-ai-generated-look-in-your-frontend-1ahh), read 2026-08-24) or a linter with explicit hex lists and P0/P1/P2 severities ([OpenDesign](https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md), read 2026-08-24). A style guide nobody can fail is a style guide that will be ignored. Recommend: ESLint/Stylelint rules for the colour and radius bans, arbitrary-value ban, and a CI check for emoji in headings.

6. **Do not chase the low-signal tells.** Bento grids (0.1% of complaints, actively defended), glassmorphism (0.2%), mesh/aurora backgrounds, and dark mode itself are explicitly "cleared by data — do not chase" ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). Spend the budget on states, density, tracking and the accent.

7. **One trap to avoid:** the escape from Inter is now itself a tell. Cream backgrounds (`#faf8f5`, `bg-stone-50`), a serif display face (Instrument Serif, Fraunces, Playfair), and a deep emerald primary (`#15573a`) is the current "tasteful default" and reads as AI to anyone who has looked at output recently ([Unslop UI](https://www.claudecodehq.com/playbooks/unslop-ui), read 2026-08-24). Whatever we pick must be anchored to a stated reason, not to what looks nice this quarter.

## Sources

| Source | Type | Published | Read | URL |
|---|---|---|---|---|
| Developers Digest — *AI Design Slop: 16 Patterns That Out Your App as Vibe-Coded* | blog | 2026-04-22 (upd. 2026-06-10) | 2026-08-24 | https://www.developersdigest.tech/blog/ai-design-slop-and-how-to-spot-it |
| Claude Code HQ — *Unslop UI: Kill the AI Design Tells* | playbook | mid-2026 | 2026-08-24 | https://www.claudecodehq.com/playbooks/unslop-ui |
| OpenDesign — `craft/anti-ai-slop.md` | repo doc | 2026 (main branch) | 2026-08-24 | https://github.com/nexu-io/open-design/blob/main/craft/anti-ai-slop.md |
| OpenDesign — `craft/color.md` | repo doc | 2026 | 2026-08-24 | https://github.com/nexu-io/open-design/blob/main/craft/color.md |
| OpenDesign — `craft/typography.md` | repo doc | 2026 | 2026-08-24 | https://github.com/nexu-io/open-design/blob/main/craft/typography.md |
| OpenDesign — `craft/typography-hierarchy.md` | repo doc | 2026 | 2026-08-24 | https://github.com/nexu-io/open-design/blob/main/craft/typography-hierarchy.md |
| OpenDesign — `craft/state-coverage.md` | repo doc | 2026 | 2026-08-24 | https://github.com/nexu-io/open-design/blob/main/craft/state-coverage.md |
| OpenDesign — `craft/animation-discipline.md` | repo doc | 2026 | 2026-08-24 | https://github.com/nexu-io/open-design/blob/main/craft/animation-discipline.md |
| VibeCodeKit — *AI Slop Design: Why AI-Generated UI Looks Generic* | blog | 2026 | 2026-08-24 | https://vibecodekit.dev/ai-slop-design |
| Slicer.dev — *Why AI-generated UI all looks the same* | blog | 2026-04-27 | 2026-08-24 | https://slicer.dev/blog/why-ai-generated-ui-looks-the-same |
| SmoothUI — *AI Design Slop* | blog | 2026-06-24 | 2026-08-24 | https://smoothui.dev/blog/ai-design-slop |
| Managed Code — *AI Slop in Design* | blog | 2026-03-02 | 2026-08-24 | https://www.managed-code.com/blog-post/ai-slop-in-design |
| Alan West (DEV) — *How to fix the "AI-generated" look in your frontend* | blog | 2024-05-18 (**>24mo**) | 2026-08-24 | https://dev.to/alanwest/how-to-fix-the-ai-generated-look-in-your-frontend-1ahh |
| GenDesigns — *Why Your AI-Generated UI Looks Bad: 15 Mistakes* | blog | 2026-03-15 (upd. 2026-08-08) | 2026-08-24 | https://gendesigns.ai/blog/ai-generated-ui-mistakes-how-to-fix |
| Refactoring UI — skill distillation (ZLStas/skills) | repo doc | 2026 | 2026-08-24 | https://github.com/ZLStas/skills/blob/main/skills/refactoring-ui/SKILL.md |
| Joel Sleppy — *Notes on Refactoring UI* | blog | undated | 2026-08-24 | https://www.joelsleppy.com/blog/notes-on-refactoring-ui/ |
| Blake Crosley — *Type Scales: How I Chose 13 Steps and Why the Ratio Matters* | blog | 2026-02-08 | 2026-08-24 | https://blakecrosley.com/blog/typography-systems |
| Pencil & Paper — *UX Pattern Analysis: Enterprise Data Tables* | article | 2026-02-23 | 2026-08-24 | https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables |
| Art of Styleframe — *Dashboard Data Density Patterns: How Much Is Too Much* | blog | 2026-08-03 | 2026-08-24 | https://artofstyleframe.com/blog/dashboard-data-density-patterns/ |
| Stan Vision — *UI Card Design: Examples, Best Practices & Common Patterns* | journal | 2026-03-23 (upd. 2026-07-23) | 2026-08-24 | https://www.stan.vision/journal/ui-card-design-examples-best-practices-and-common-patterns |
| Designpixil — *B2B SaaS UI Design Principles* | blog | upd. 2026-05 | 2026-08-24 | https://designpixil.com/blog/b2b-saas-ui-design-principles |
| Cloud Four — *The Math Behind Nesting Rounded Corners* | blog | 2022-10-26 (**>24mo**) | 2026-08-24 | https://cloudfour.com/thinks/the-math-behind-nesting-rounded-corners/ |
| PV21 Design — *Concentric Radius: Nested Corners Done Right* | blog | undated | 2026-08-24 (via search summary) | https://pv21design.pt/concentric-radius-nested-corners-done-right/ |
| Rails Designer — *Mathematical and optical alignment in (visual/UI) design* | blog | 2024-11-11 | 2026-08-24 | https://railsdesigner.com/mathematical-optical-alignment-design/ |
| Marvel Blog — *Optical Adjustment: Logic vs. Designers* | blog | undated | 2026-08-24 | https://marvelapp.com/blog/optical-adjustment-logic-vs-designers/ |
| ColorArchive — *Neutral Color Palettes: Warm vs Cool* | guide | undated (© 2026) | 2026-08-24 | https://colorarchive.org/guides/neutral-color-palettes/ |
| Linear — *How we redesigned the Linear UI (part II)* | vendor blog | 2024-03-28 (**>24mo**) | 2026-08-24 | https://linear.app/now/how-we-redesigned-the-linear-ui |
| Lucide — *Stroke width* guide | docs | undated | 2026-08-24 | https://lucide.dev/guide/lucide/basics/stroke-width |
| ICON OOP — *Lucide Icons: naming, sizing, setup* | blog | undated | 2026-08-24 (via search summary) | https://iconoop.com/lucide-icons.html |
| SaaSUI — *B2B SaaS Design: Principles, Patterns & Real Examples* | blog | undated | 2026-08-24 | https://www.saasui.design/blog/b2b-saas-design |
| SaaSUI — *SaaS Navigation UX Patterns* | blog | undated | 2026-08-24 | https://www.saasui.design/blog/saas-navigation-ux-patterns |

## Still unknown

- **Hacker News threads returned HTTP 429 on every attempt** (items 46677824 "Show HN: A Tailwind component generator focused on design quality, not AI slop", 48920888 "Show HN: StyleSeed", 49398493 "Five things make agent-built UI look generic"). I found them via the Algolia API but could not read the comments. Practitioner dissent and counter-arguments are therefore under-represented here — everything above skews toward people selling a fix. Worth a second pass when HN is not rate-limiting.
- **No first-hand designer teardown of a specific AI-built CRM.** Everything B2B-specific here is generic dashboard/table guidance applied by me. If the product owner can name the products they consider well-crafted, that reference is worth more than any of this.
- **Prevalence numbers are single-vendor and unaudited.** "22% heavy slop / 32% mild / 46% clean", "identical feature cards on 22% of pages" (Developers Digest) and the complaint-share percentages (Unslop UI) have no published methodology. Directional only.
- **The Bringhurst §3.2.7 caps-tracking citation and the CHI 2025 inaccessible-markup finding are second-hand.** Both are quoted by sources I read; I did not read either primary work. Marked `UNVERIFIED` at point of use.
- **Density tiers conflict across sources by roughly one tier** (Pencil & Paper's condensed 40px vs Art of Styleframe's standard 36–40px / compact 28–32px). Resolve by measuring against a real sales user's task — "how many rows must be visible to work a day's queue without scrolling" — not by picking a number from a blog.
- **The Linear `scale(0.97)` active-state detail is unverified.** Easy to confirm by inspecting Linear's own CSS; worth doing before copying.
- **APCA vs WCAG 2.x.** One source recommends APCA targets (Lc ≥75/45/30) over WCAG ratios. Which we adopt affects every colour token. Needs a decision, not more reading — and note APCA is not the normative standard in WCAG 2.2, so an accessibility commitment written into a customer contract should still be expressed in WCAG terms.
