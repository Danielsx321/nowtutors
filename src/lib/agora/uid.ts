/**
 * The deterministic Agora uid (SPEC §9 step 4).
 *
 * Agora identifies a client in a channel by a 32-bit unsigned integer, and the
 * SDK will happily assign a random one on join. We do not let it: a reconnect —
 * a dropped socket, a refresh, a phone waking up — must come back as the *same*
 * participant, or the peer sees a stranger arrive while the person they were
 * talking to appears to still be there. Hashing the profile id gives that for
 * free, with no extra state to store and nothing to keep in sync.
 *
 * FNV-1a, 32-bit. Not a security primitive and not trying to be — a uid is a
 * routing label inside a channel, not a credential (the credential is the token,
 * which the server mints against the channel). FNV-1a is chosen for being short,
 * dependency-free and deterministic across runtimes, which is the whole
 * requirement. Two profile ids colliding would put two people on one uid, but at
 * 2^32 buckets and two participants per channel that is not a risk worth
 * carrying state to avoid.
 *
 * `server-only`-free and pure so the properties that matter — same input, same
 * uid; never zero — are unit-testable, and so the browser wrapper can derive the
 * same value if it ever needs to without a second implementation.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * A stable uid in Agora's `1 … 2^32 - 1` range for this profile id.
 *
 * **Zero is excluded deliberately.** Agora reads uid 0 as "assign me one", which
 * is precisely the non-deterministic behaviour this function exists to prevent —
 * so the one hash output that would silently re-enable it is mapped away.
 */
export function agoraUid(userId: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    // Math.imul keeps the multiply in 32-bit space; `>>> 0` returns it to
    // unsigned. Plain `*` would lose precision past 2^53 within a few rounds.
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash === 0 ? 1 : hash;
}
