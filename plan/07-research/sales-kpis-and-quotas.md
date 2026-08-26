# Research: sales KPIs, quotas and activity targets

- **Date:** 2026-08-26
- **For:** `plan/04-features/kpis/plan.md`
- **Confidence:** Mixed. The conceptual material is well sourced; the **benchmark numbers are not**. The web search budget for this session was exhausted (200/200), so I could reach only pages I could name directly. Anything below without a citation is domain knowledge, not a retrieved source, and is marked as such. **Do not put an uncited number in a product default.**

## 1. The central finding: this feature's main risk is the feature itself

Activity KPIs are the textbook case of Goodhart's law. Charles Goodhart, 1975: *"Any observed statistical regularity will tend to collapse once pressure is placed upon it for control purposes."* Marilyn Strathern's generalisation is the version that matters here: **"When a measure becomes a target, it ceases to be a good measure."**

The documented failure mechanisms are exactly what a call quota does to a sales team:

| Mechanism | What it looks like here |
|---|---|
| Gaming | 40 logged calls, 3 real conversations |
| Corruption pressure | Activities logged against records nobody actually worked |
| Systematic degradation | Once everyone hits 40, the number stops discriminating between reps |

The healthcare example transfers almost directly: hospitals told to reduce length-of-stay discharged patients early and readmissions rose. The metric improved and the outcome got worse. A rep told to make 40 calls a day will make 40 calls a day, and the calls will get shorter.

**This does not mean don't build it.** It means the design has to assume the metric will be gamed, and make gaming visible rather than pretending it won't happen. Concretely: never show an activity count without the outcome it was supposed to produce sitting next to it.

## 2. Committed vs aspirational — take this from OKR

The OKR literature separates two kinds of target and grades them differently: **committed** key results are binary and expected at 1.0; **aspirational** ones are set so that **0.7 is success**. It also advises measuring **leading indicators** rather than lagging ones, so there is time to course-correct.

The direct implication for this feature, and the single most important design decision in it:

- **Quota (revenue, deals won) is committed.** 100% is the expectation. Missing it is a real miss.
- **Activity targets are aspirational.** 70% is fine. An activity target displayed with the same red/green treatment as quota teaches the team that activity *is* the goal, which is the Goodhart failure.

The same literature warns that individual-level OKRs degrade into task lists when conflated with performance evaluation. Read across: **an activity target is a coaching tool, not a performance rating.** The product should not compute anything that looks like a score for a person.

## 3. The KPI catalogue

From Klipfolio's sales KPI reference, with formulas as given:

**Outcome / lagging**
| KPI | Formula |
|---|---|
| Total sales revenue | Quantity sold × price |
| Win rate | Closed-won deals ÷ total opportunities |
| Average revenue per customer/account | — |
| Annual contract value | Total contract value ÷ years |
| Customer lifetime value | Total expected spend over the relationship |
| Churn rate | Churned customers ÷ total customers |
| Revenue from new vs existing customers | New (or existing) customer sales ÷ total revenue × 100 |

**Process / leading**
| KPI | Formula |
|---|---|
| **Quota attainment** | % of quota achieved, per rep |
| **Weighted pipeline value** | Deal value × probability of closing |
| Average sales cycle length | Time from first consideration to purchase |
| **Deal slippage** | Deals missing their forecast close period |
| Sales expense ratio | Net sales ÷ operating expenses × 100 |
| Market penetration | Total customers ÷ target market × 100 |

Klipfolio's own caution is worth keeping: *"not every metric will be useful for achieving your goals"* — check each for relevance rather than shipping the whole catalogue.

Their marketing list names Cost per Lead, MQL→SQL conversion, CAC, CLV, retention and NPS, but **gives no formulas on that page**, so nothing from it is quoted as authoritative here.

## 4. Pipeline coverage — the one leading indicator that predicts quota

*(Domain knowledge, not retrieved this session — treat the ratio as a starting point to calibrate, not a fact.)*

```
coverage = open weighted pipeline ÷ quota still to be made this period
```

It is the earliest honest signal of whether a period will land: it moves weeks before revenue does, and unlike an activity count it cannot be improved by doing more of something cheap. The commonly cited healthy band is **3×–4×**, but the correct number for any team is *1 ÷ win rate*, which this app can compute from real history instead of borrowing someone else's benchmark. A team that wins 33% needs 3×; a team that wins 50% needs 2×, and telling them to hold 4× makes them chase junk.

**Recommendation: derive the target coverage from the team's own trailing win rate and show the derivation.** That is a genuinely better answer than a hardcoded 3×, and this codebase already computes win rate in `reports.ts`.

## 5. What is missing in this codebase to measure honestly

Checked against the schema, not assumed:

| Needed for | Present? |
|---|---|
| Revenue won in a period | ✅ `Deal.value`, `closedAt`, `Stage.isWon` |
| Deals won / lost + reason | ✅ `Deal.lostReason`, `Stage.isWon`/`isLost` |
| Sales cycle length | ✅ `Deal.createdAt` → `closedAt` |
| Deal slippage | ✅ `Deal.expectedCloseDate` vs `closedAt` — both stored; the field is captured and sorted on, but **the two are never compared**, so slippage is unmeasured |
| Weighted pipeline | ✅ `Stage.probability` |
| First touches | ✅ `Lead.firstTouchedAt` |
| Speed to lead, in working hours | ✅ already built (`lib/business-hours.ts`) |
| Calls / emails / meetings logged | ⚠️ `Activity.type` exists, but see below |
| **Call duration or outcome** | ❌ **Absent.** `Activity` has type, subject, body, occurredAt — no duration, no outcome, no connected/no-answer. |
| **Meeting held vs merely booked** | ❌ Absent. No way to distinguish a meeting that happened from one that no-showed. |
| Recurring revenue / retainers | ❌ Absent. Deals are one-off amounts. **An agency lives on retainers**, so "revenue won" understates the business badly. |
| Cost per lead | ❌ Absent — no spend data anywhere, unchanged from the outreach plan. |

The two ❌ marked in bold are the ones that decide how honest this feature can be:

- **Without duration or outcome on an Activity, a "calls" KPI is an honour system.** It counts rows a rep created. Anyone can create 40. This is not an argument against shipping it — it is an argument for saying so on the screen, and for adding the fields.
- **Without a meeting-held flag, "meetings booked" is the most gameable metric in sales.** Booked meetings that no-show cost nothing to produce.

## 6. What I could not verify

- Quota-to-OTE multiples, standard attainment rates, and ramp periods — every source I could name was 403 or 404 and search was exhausted. **No default quota should ship without these.**
- Agency-specific benchmarks (retainer churn, revenue per account manager, utilisation).

## Sources

- [Sales KPIs — Klipfolio](https://www.klipfolio.com/resources/kpi-examples/sales)
- [Marketing KPIs — Klipfolio](https://www.klipfolio.com/resources/kpi-examples/marketing)
- [Goodhart's law — Wikipedia](https://en.wikipedia.org/wiki/Goodhart%27s_law)
- [Objectives and key results — Wikipedia](https://en.wikipedia.org/wiki/Objectives_and_key_results)
