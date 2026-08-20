# NowTutors

Read docs/SPEC.md before doing anything. It is authoritative.

## Rules
- Never change the database schema without updating docs/SPEC.md Section 4 in the same commit.
- Never add a dependency not listed in SPEC Section 2 without asking first.
- All money and credit mutations go through lib/credits/ledger.ts. Never UPDATE wallets.credit_balance directly.
- All Agora tokens are issued through /api/agora/token, never client-side, never by calling the Render service from the browser.
- Server-side authorization on every route handler and Server Action. Do not rely on the client hiding a button.
- Write the migration, then the query layer, then the UI. In that order.
- No setInterval polling anywhere except the presence heartbeat.
- If something in the spec is ambiguous, stop and ask. Do not guess and proceed.
- When an open question or product decision is settled, update the affected SPEC.md section in the same commit as the DECISIONS.md entry. Settled answers must not live only in DECISIONS.
- One phase at a time. Do not start the next phase until told.

## Log
Append every non-obvious decision to docs/DECISIONS.md as you make it.
