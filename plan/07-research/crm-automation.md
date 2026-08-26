# Research: how CRMs model automation

- **Date:** 2026-08-26
- **For:** `plan/04-features/automation/plan.md`
- **Method:** rendered the vendor help centres in a real browser. Their docs are client-rendered SPAs that return a loading shell to plain fetchers, which is why earlier attempts at these URLs came back empty.
- **Confidence:** High for Attio and HubSpot — both quoted from their own current documentation. Pipedrive's automations article 404'd; nothing here is attributed to it.

## 1. The shape everyone converges on

**A trigger, then steps.** Attio: *"At the heart of workflows are two primary components: trigger blocks that initiate the workflow, and steps that execute specific tasks."* HubSpot tells its AI assistant to take prompts in the form *"When [this happens], then [do this]"* — the same shape stated as a sentence.

Attio names the two halves of every block, and this is the part worth stealing:

> **Inputs** are the values you configure in the block, such as the object, list, conditions, or instructions. **Outputs** are the values a block returns during a workflow run, which you can use later in the workflow as variables.

That distinction is what makes a rule engine composable rather than a list of canned macros: each step publishes named outputs that later steps can read.

## 2. The trigger taxonomy

From Attio's block library, grouped as they group it:

| Group | Triggers |
|---|---|
| **Record** | Record created · Record updated (optional: only when *this* attribute changes) · Attribute value changed · Record action (a manual "run workflow" button on the record) |
| **List** | List entry created / updated / action |
| **Task** | Task created |
| **Note** | Note created · Note action |
| **Utilities** | **Webhook received** · **Manual run** · **Recurring schedule** (daily / weekly / monthly / cron, with an explicit timezone) |

HubSpot calls the equivalent *enrollment triggers*, and adds **manual enrollment** and **frequency-based** enrollment alongside event triggers.

## 3. Three details that are easy to get wrong, and that these vendors document

**3.1 "Updated" and "first set" are different events.** Verbatim from Attio: *"Record updated does not trigger when: an attribute value is first set during record creation (use Attribute value changed instead)"* — and `Attribute value changed` *"also fires if the attribute is given a value when a record or list entry is created."*

A naive engine that fires "record updated" on creation will double-fire every automation on every new record. This distinction has to exist in the trigger vocabulary, not be left to the rule author.

**3.2 An event can fire before the data it describes exists.** Attio on `Note created`:

> Notes created manually in Attio: the workflow triggers as soon as the note is created, **before its title and content have been entered**.

Their own remedy is a Delay block "of several minutes rather than seconds so that content changes have time to save", or a manual trigger instead. This is the single most useful warning in the whole body of documentation: *an event carries the record as it was at that instant, not as the user will eventually leave it.*

**3.3 Re-enrollment is a first-class setting, not an implementation detail.** HubSpot: *"add enrollment triggers and configure re-enrollment and unenrollment settings."* Without an explicit answer to "may the same record enter this automation twice", a rule that updates a field its own trigger watches is an infinite loop. Every engine needs a stated position on this.

## 4. Permissions are split

HubSpot separates them: *"To create workflows, users must have Edit permissions for workflows or Super Admin permissions. To publish workflows, users must have Publish permissions."*

Building an automation and turning it loose on live records are different acts with different blast radii. Worth mirroring — a draft anyone can write, a live rule a manager turns on.

## 5. What this means for us

The engine we need is the small, honest subset:

- **Triggers:** lead created · lead status changed · deal stage changed · task completed · a scheduled sweep. All of these already emit somewhere in our services.
- **Conditions:** reuse the segment filter document from `lib/validation/segments.ts` rather than inventing a second condition language. We already have a validated, translated-to-`where`, injection-safe filter vocabulary; a rule's condition is the same question asked of one record.
- **Actions:** assign an owner, set a field, add a tag, create a task, send a notification, enrol in a campaign. Every one of those is an existing service call.
- **Loop protection:** mandatory, and decided up front (see 3.3).
- **A run log**, because an automation nobody can audit is one nobody will trust with their pipeline.

Deliberately NOT in a first version: branching, delays, AI steps, arbitrary webhooks out. Attio has all four; we do not need them to make "when a Facebook lead arrives worth more than 70, assign it to the duty rep and make a call task" work, and each one multiplies the states a run can be in.

## Sources

- [Attio — Workflows block library](https://attio.com/help/reference/automations/workflows/workflows-block-library) (read 2026-08-26)
- [HubSpot — Create workflows](https://knowledge.hubspot.com/workflows/create-workflows) (last updated 3 Aug 2026; read 2026-08-26)
