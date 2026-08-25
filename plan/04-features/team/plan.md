# Feature: Team and invitations

- **Status:** Shipped 2026-08-24
- **Owner role:** crm-security + crm-backend-dev
- **Milestone:** M0 (leftover, unblocked M3a)

## Problem
Every organization was single-user. That quietly broke three features already built: round-robin assignment had one candidate, SLA escalation had nobody above the owner to escalate to (live sweep reported `escalated: 2, escalationAlerts: 0`), and record ownership was meaningless. A CRM you cannot add your team to is not a CRM.

The `Invitation` model had existed unused since M0.

## What shipped
- **Invite** by email with a role — Admin, Manager, Rep, Read-only.
- **Accept** at `/invite?token=…`: sets a name and password, creates the user, signs them straight in.
- **Manage**: change a member's role inline, deactivate a member, revoke a pending invitation.
- **Team page** at `/settings/team`, with a warning while you are the only member.

## Security decisions
- **Tokens are stored as SHA-256 hashes, never in plaintext.** The raw value is returned once at creation and shown to the admin to copy. Losing it means regenerating, not recovering — the honest trade for not keeping a bearer secret in the database.
- **The accept page never says *why* a token failed.** Expired, revoked, and never-existed all render the same page, so it cannot be used to probe for valid tokens.
- **The organization comes from the invitation row, never from input.** A test passes a crafted `organizationId` and asserts the account still lands in the inviting org.
- **Single use, enforced in the transaction** that creates the user, so a replayed link cannot create a second account.
- **Re-inviting replaces** the outstanding invitation and invalidates the previous link in the same step.
- **OWNER is not an assignable role.** Ownership transfers; it is not handed out through an invite form.
- **Nobody acts on themselves** — no self-role-change, no self-deactivation — and the last owner cannot be deactivated, or the organization becomes unadministrable.
- **Deactivation is a soft delete**, so the person's name still resolves on the records they touched.

## Verified
19 tests: token hashing, single use, expiry, revocation, re-invite superseding, org-from-token, permission floors (Rep and Manager cannot invite), cross-tenant revoke, self-action guards, last-owner protection, soft delete.

Live: team page renders with the solo-member warning; an invalid token shows the generic unavailable page; two real invitations created and the accept page renders the right org, role, and locked email.

## Not built
- **No email delivery.** The admin copies the link and sends it. This is the single biggest gap and it is the same blocker as notification email — it needs a provider account.
- No resend-without-regenerating (regenerating is the workaround).
- No ownership transfer flow.
- No bulk invite.
