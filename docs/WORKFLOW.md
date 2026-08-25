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

## Merges are Daniels' call — the execution seat may now type the command, but does not decide

**Amended 2026-08-23/24.** The execution seat **may EXECUTE `gh pr merge --squash`** on a PR whose
`verify` check is green **and** which the advisory seat has explicitly approved. **It does not
decide to merge.** What changed is who types the command, not who takes the decision — the actual
judgment call (is this PR ready) still belongs entirely to the advisory seat, and still has to be
given explicitly, in the message, for that specific PR. A "do not merge" in the prompt that created
the PR is not overridden by anything the execution seat decides on its own afterwards, and silence
is not approval — the execution seat opens a PR and stops unless told to merge that one.

**A scoped permission now backs this**, rather than the classifier's judgment alone:
`.claude/settings.local.json` (machine-local, gitignored) allows `Bash(gh pr merge:*)` specifically —
not `gh` broadly, not `git push`. See DECISIONS.md for the full reasoning on both sides of that call.

*A caveat on the classifier itself, uncertain and worth flagging rather than asserting either way:*
an earlier version of this section claimed the auto-mode classifier does not block `gh pr merge` at
all. In the 2026-08-23/24 session, the classifier **did** block `gh pr merge 25 --squash` on first
attempt — before the `Bash(gh pr merge:*)` permission rule existed — and the identical command
succeeded immediately once that rule was added. Whether the classifier's behavior toward this
specific command is permission-state-dependent, or something else changed between attempts, isn't
established here. Don't rely on the classifier as a safety net either way; the explicit-approval
convention above is what actually gates this, not the classifier's mood.

**Daniels can still run merges manually** from `~/nowtutors`, after reviewing:

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

## Session close

Triggered when the overseer says the session is ending, or any equivalent ("let's close out",
"wrap up", "session end"). Distinct from the end-of-phase checklist above — a session can close
mid-phase, and a phase can span several sessions. See `ADVISORY.md` for what triggers this and why
it has to land as one message.

**One Claude Code run does all of the following:**

a. Update whichever of `SPEC.md`, `DECISIONS.md`, `PROGRESS.md`, `RUNBOOK.md`, `ADVISORY.md`,
   `WORKFLOW.md` changed this session. One branch, one PR — not one PR per file and not one PR per
   doc-writing pass.
b. Write `HANDOFF.md` to `~/Desktop/nowtutors-docs`. **This file is not in the repo.** It lives
   only in the pickup directory, which is exactly why it gets missed when the close is split across
   runs — there is no `git status` anywhere that would flag a stale or missing `HANDOFF.md`, unlike
   every other file this procedure touches.
c. Overwrite **all seven** files in `~/Desktop/nowtutors-docs` — the six repo docs plus
   `HANDOFF.md` — **not only the ones that changed.** That directory is the pickup point for
   project knowledge and has to match the repo exactly; a partial overwrite leaves some files one
   commit behind without anything surfacing the gap (same failure mode as the doc pickup path
   above, one folder over).
d. End with `ls -la ~/Desktop/nowtutors-docs/`, so the seven-file listing is the last thing in the
   run's own output — not asserted, shown.

**Then, outside Claude Code:** the overseer deletes the existing files from project knowledge and
uploads the seven fresh ones. Delete before uploading, so no stale copy survives alongside a new
one — project knowledge has no overwrite semantics of its own to rely on here.

**The handoff note's content is authored by the advisory seat, not by Claude Code.** The advisory
seat supplies the handoff text inside the close prompt (for step b to write verbatim) **and**
delivers the identical text in chat, ready to paste into the next conversation. Claude Code does
not compose the handoff — it writes exactly what the prompt gave it. A session-close message that
contains only the prompt, with no handoff text in the chat itself, is incomplete (`ADVISORY.md` #8).
