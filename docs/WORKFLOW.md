# NowTutors — Workflow

_How work actually moves between the two seats on this project. Read this if you're picking up a
phase cold, or if a prompt didn't produce what the other seat expected._

## The two seats

**Advisory seat** — spec authoring, schema design, phase planning, and drafting the prompts that go
to the execution seat. Works from the docs in `docs/` and from `~/Desktop/nowtutors-docs`. Does not
run `pnpm`, `git`, migrations, or deploys.

**Execution seat (Claude Code)** — runs everything: `pnpm` scripts, `git`, migrations, local gates,
deploys. Reads the docs the advisory seat produced, implements against them, opens PRs. Does **not**
merge (see below).

Neither seat substitutes for the other. The advisory seat doesn't touch the repo; the execution seat
doesn't invent scope the docs didn't ask for — if SPEC/DECISIONS/PROGRESS is ambiguous or silent on
something material, that's a stop-and-ask, not a guess (CLAUDE.md: "If something in the spec is
ambiguous, stop and ask").

## Doc pickup path: `~/Desktop/nowtutors-docs`

The advisory seat writes `SPEC.md`, `DECISIONS.md`, `PROGRESS.md`, `RUNBOOK.md`, and this file to
`~/Desktop/nowtutors-docs`. That folder — not the advisory seat's own working copy, not a pasted
diff — is the handoff point the execution seat reads from at the start of a phase.

**When a phase's PR is still OPEN, pick up docs from the FEATURE BRANCH, not `main`.**

This is the one rule in this document responsible for the most wasted time so far. `main` does not
yet contain the sections a phase in flight is adding or amending — they exist only on that phase's
branch until the PR merges. Copying `SPEC.md`/`DECISIONS.md` from `main` while a phase is open
**silently reverts** whatever that phase's branch already wrote into those files: the copy succeeds,
the file looks fine, and the phase's doc changes are simply gone until someone notices in review or,
worse, doesn't. There is no error to catch this — it looks exactly like a normal doc update.

How to apply: before overwriting `~/Desktop/nowtutors-docs`, check whether the phase's PR is open.
If it is, pull the docs from that PR's branch (`git show <branch>:docs/SPEC.md`, or check out the
branch), not from `main`. Only pull from `main` once the PR has merged.

*Why this document exists at all:* it wasn't tracked in the repo, which is exactly why PR #12's
items 2–3 (doc-sync steps) got skipped — there was nowhere checked-in to point at, so the step had
no home and fell out of the loop silently. Tracking it here closes that gap.

## Merges are Daniels' call — but they are a convention, not a technical block

**Corrected 2026-08-23.** This section previously said the execution seat's auto-mode classifier
*blocks* `gh pr merge`. **That is not true, and relying on it as a safety net would be a mistake.**
In the 2026-08-23 session the execution seat ran `gh pr merge 19 --squash` and
`gh pr merge 20 --squash` at Daniels' explicit instruction and **both succeeded**. What the
classifier did block in that same session was a direct write to the shared production database (an
attempt to probe `CREATE EXTENSION` / Vault privileges over the `.env.local` connection) — so the
classifier is real, but it draws its line around destructive writes to shared infrastructure, not
around `gh pr merge`.

The rule therefore stands on its own merits rather than on enforcement: **merges are a human
decision point, not a mechanical last step of implementation.** The execution seat opens PRs and
stops. It merges only when Daniels asks for that specific merge, in that message — a "do not merge"
in the prompt that created the PR is not overridden by anything the execution seat decides on its
own afterwards.

**Daniels normally runs merges** from `~/nowtutors`, after reviewing:

```bash
gh pr merge <N> --squash
```

Squash, not merge-commit or rebase — keeps `main`'s history one commit per phase/PR, matching how
`PROGRESS.md` cites merge commits (`**Merged via PR #N (\`sha\`).**`).

If a PR needs changes after the execution seat reports it ready, that's a normal review comment or a
follow-up prompt to the execution seat — not a reason to merge anyway and fix forward, unless
explicitly decided otherwise.

## Prompt format

Prompts from the advisory seat to the execution seat carry a **model + effort line** at the top,
naming which model and reasoning effort the task warrants — a docs-only cleanup and a settlement
reorder touching money don't need the same budget.

**`/clear` before each prompt.** The execution seat's context does not carry state between unrelated
tasks by convention here — each prompt starts clean and is self-contained: it names the branch, the
files to read, the change to make, and what "done" looks like (tests, docs to update, whether to
open a PR or merge). A prompt that depends on the execution seat remembering the previous one is a
sign the prompt itself is under-specified.

## End-of-phase checklist (advisory seat)

1. Confirm the phase's PR is merged (or, if still open, note that explicitly to whoever picks up
   docs next).
2. Update `SPEC.md` / `DECISIONS.md` for anything settled or built that isn't reflected yet.
3. Bring `PROGRESS.md` to true state: what shipped, what's still open, what carries forward.
4. Overwrite all five files in `~/Desktop/nowtutors-docs` — `SPEC.md`, `DECISIONS.md`,
   `PROGRESS.md`, `RUNBOOK.md`, `WORKFLOW.md` — from the versions on `main` (or the open branch, per
   the rule above). This step is not optional and not implicit in "I edited the repo" — the pickup
   folder is a separate copy and has to be told about the change.
