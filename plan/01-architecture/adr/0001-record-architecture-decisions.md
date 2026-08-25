# 0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-08-23
- **Owner:** crm-architect

## Context
Ten agents work on this codebase in parallel. Without a written record, decisions get re-litigated, silently reversed, or contradicted in another module — and nobody can tell which is intentional.

## Decision
Every structural decision is recorded as a numbered ADR in this folder. Each states the context, the decision, the alternatives rejected and *why each lost*, and the consequences. Decided ADRs are immutable; a change means a new ADR that supersedes the old one.

## Alternatives rejected
- **Decisions in commit messages** — unsearchable, no alternatives captured, lost in a squash.
- **One long architecture doc** — accretes, nobody reads it, no way to see when or why something changed.

## Consequences
- Slight overhead per decision; large saving on re-litigation.
- New agents can read the ADR log and understand the system's reasoning, not just its state.
