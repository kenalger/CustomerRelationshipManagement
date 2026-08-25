# Views, edits and creates as dialogs

- **Status:** Shipped 2026-08-24
- **Requested by:** product owner — "all views, edit, and create should be in a modal, not another page"

## How it works

Next.js **parallel + intercepting routes**, not local state.

```
src/app/(app)/
  @modal/
    default.tsx                  -> null when nothing is intercepted
    (.)contacts/[id]/page.tsx    -> dialog over the list
    (.)contacts/new/page.tsx
    (.)companies/[id]/page.tsx
    (.)companies/new/page.tsx
    (.)deals/new/page.tsx
  contacts/[id]/page.tsx         -> the same record as a full page
```

The URL stays the source of truth, which buys three things a state-only modal cannot have:

| Action | Behaviour |
|---|---|
| Click a record in a list | Dialog opens over the list; the row stays visible behind it |
| Copy the URL and send it | Recipient gets the **full page** |
| Refresh while the dialog is open | Renders the **full page**, not a dialog over nothing |
| Browser Back | Closes the dialog |

Verified: a direct load of `/contacts/{id}` and `/contacts/new` returns HTML containing **zero** `role="dialog"` nodes, so the hard-navigation fallback is real rather than assumed.

## The bug this pattern creates, and the fix

"Open full record" inside the dialog pointed at the very URL being intercepted, so a `<Link>` click would re-intercept and appear to do nothing. It is a plain `<a>` — a hard navigation is the only way out to the full page. This is a genuine trap in the pattern and easy to ship broken.

## Layer scoping — the part that breaks first

`plan/07-research/crm-ui-mechanics.md` flagged our palette as using a bare global `keydown` listener, and noted this "breaks as soon as a modal or dropdown sits over a grid." Twenty solves it with a typed focus stack.

`src/lib/layer-stack.ts` is a small version of that. Every overlay pushes on mount and pops on unmount; only the **top** layer reacts to keys. So:

- ⌘K refuses to open while a dialog is open — two overlays would leave Escape ambiguous.
- Escape closes the topmost layer only.
- A layer unmounting out of order does not corrupt the ordering.

8 unit tests cover it, including out-of-order close and popping an id that was never pushed.

## Dialog mechanics
- `role="dialog"` + `aria-modal` + `aria-label`.
- **Focus trap** on Tab and Shift+Tab; without it Tab walks into the page behind.
- Focus is returned to whatever was focused before, on close.
- The panel is focused on open, **not the first input** — a dialog that grabs the caret makes Escape feel unreachable and scrolls long forms.
- Body scroll lock compensates for the scrollbar width, so the page behind does not jump sideways.
- The scrim closes on click, but only when the click *started* on the scrim — a drag that ends there does not.
- Sizes: `sm/md/lg/xl`. Creates use `md`, record views use `lg`.

## Layout decision
The dialog uses **one column**, not the page's two-column layout. At dialog width a squeezed activity timeline is unreadable. Fields, related records, tasks and timeline stack in reading order.

Field lists live in `src/components/crm/fields/*` and are rendered by **both** the page and the dialog. Duplicating them is how the two silently drift apart.

## Not done
- **Deal detail has no dialog yet** — only deal *create*. Its stage picker, lost-reason flow and aging panel need a narrow-container layout of their own.
- No peek/preview: no `Space` to open, and no `↑`/`↓` to move through adjacent records with the dialog staying open. Every product studied has this and it is the natural next step.
- No "open as" preference (Notion, Attio and Twenty all make side-panel vs full-page a setting).
- Settings, import and leads still navigate as pages.
- **Unverified:** the soft-navigation dialog itself. The hard-navigation fallback is confirmed by request; the dialog opening on a click needs a browser and I have not seen it render.
