# 0003 — Hosting: Vercel now, Cloudflare as the commercial escape hatch

- **Status:** Accepted
- **Date:** 2026-08-23
- **Owner:** crm-devops

## Context
The product owner asked to stay on free tiers. This is a **B2B CRM the company intends to use**, which makes the licence terms of a free plan as important as its resource limits.

## Decision
Deploy to **Vercel Hobby during development**, and move to **Vercel Pro before the company uses the app for real work**. Keep the codebase deployable to **Cloudflare Workers via OpenNext** as a zero-cost commercial fallback.

## The licence problem — read this before assuming hosting is free
Vercel's **Hobby plan is restricted to non-commercial personal use** ([Vercel pricing](https://vercel.com/pricing)). Running a company's sales pipeline on it is a terms violation, regardless of how little bandwidth we use. Hobby's resource limits (100 GB fast data transfer, 1M edge requests, 1M function invocations, 6,000 build minutes per month as of 2026-08) are generous enough — **the licence is the binding constraint, not the quota.**

Pro is $20/user/month and includes a $20 usage credit. For an internal CRM that is the honest cost of hosting, and it should be in the budget now rather than discovered at launch.

## Alternatives rejected
- **Stay on Hobby into production** — terms violation, and Vercel does enforce it. Not a risk worth a $20/mo saving.
- **Cloudflare Workers from day one** — the free plan *does* permit commercial use (100k requests/day), which is genuinely attractive. Rejected as the *starting* point because the OpenNext Cloudflare adapter adds a build-and-debug tax on every Next.js feature we touch, and we should not pay it while the product is still changing shape daily. Revisit at M3.
- **Self-host on a VPS** — cheapest at scale, but hands `crm-devops` patching, TLS, backups, and uptime for a team that does not exist yet.
- **Netlify / Render free** — same commercial-use and cold-start caveats without Vercel's Next.js integration.

## Consequences
- Budget line: **$20/month Vercel Pro** from the point real leads enter the system. Not optional.
- Avoid Vercel-proprietary APIs where a portable equivalent exists, so the Cloudflare fallback stays cheap to exercise.
- Long-running work (mailbox sync, imports) must not run inside a request. It goes to a queue — which the architecture already requires.
- Revisit at M3 with real traffic numbers: if Cloudflare's free commercial tier covers us, migrating saves the Pro subscription.
