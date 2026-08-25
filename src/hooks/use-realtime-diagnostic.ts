"use client";

import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * A THREE-LANE Realtime diagnostic. Instrumentation only — it answers a
 * question and changes nothing (DECISIONS, "the instant-request symptom
 * survives PR #49").
 *
 * **The question.** The tutor's subscription reports `SUBSCRIBED` and still
 * does not reliably deliver INSERTs on `session_requests`. Everything else has
 * been eliminated live: the row is written, the table is in the
 * `supabase_realtime` publication, RLS SELECT is
 * `((student_id = auth.uid()) OR (tutor_id = auth.uid()))`, the websocket
 * opens, replica identity is FULL, the tutor is approved/live/heartbeating,
 * `IncomingRequests` is mounted, and the countdown fault (#47) is fixed. Two
 * candidates are left:
 *
 *  a. the server-side **filter binding**, `filter: tutor_id=eq.{uuid}`; and
 *  b. the socket's **JWT** — `setAuth` is driven by the async `INITIAL_SESSION`
 *     event (supabase-js `_handleTokenChanged`) while `.subscribe()` runs
 *     synchronously on mount, so the channel may bind before the token lands.
 *
 * One lane cannot separate those. Three can, because each lane removes exactly
 * one variable and the four possible console outcomes are disjoint:
 *
 * | A | B | C | reading |
 * |---|---|---|---|
 * | fires | — | — | neither candidate; the fault is elsewhere in the production path |
 * | silent | fires | fires | auth/`setAuth` ORDERING is the fault |
 * | silent | fires | silent | the FILTER BINDING is the fault |
 * | silent | silent | silent | Realtime authorisation, deeper than token timing |
 *
 * **Lane independence is the whole design.** `@/lib/supabase/client`'s
 * `createClient()` returns a **singleton** in the browser (`@supabase/ssr`
 * caches it unless `isSingleton: false`), and one client owns one
 * `RealtimeClient` and one socket. Sharing it would mean lane B's `setAuth`
 * mutating the very socket lane A is already bound to — lane A would then be
 * testing "bound before the token, then handed the token", which is neither
 * the production condition nor a clean control, and a contaminated lane A is
 * worse than no lane A. So every lane builds its OWN client with
 * `isSingleton: false`: three clients, three sockets, and the production
 * singleton untouched beside them.
 *
 * **These clients cannot write the session.** They read the real auth cookie
 * (so lane A's `INITIAL_SESSION` fires exactly as production's does, and
 * B/C's `getSession()` returns the real token), but `setAll` is a no-op and
 * `autoRefreshToken` / `detectSessionInUrl` are off. A diagnostic that could
 * rotate a refresh token, or race the production client for an OAuth code in
 * the URL, would be capable of breaking the thing it is measuring.
 *
 * **Gated off by default.** The effect's FIRST statement checks
 * `NEXT_PUBLIC_RT_DIAG === "1"` and returns, so with the flag unset no client
 * is constructed, no socket is opened and nothing is logged.
 *
 * **It is a runtime gate, not dead-code elimination, and the difference was
 * checked rather than assumed.** Next only inlines a `NEXT_PUBLIC_*` value it
 * has at build time; with the variable absent the lookup survives
 * minification — the shipped chunk contains `"1" !== process.env.NEXT_PUBLIC_RT_DIAG`
 * and the three lanes below it. So this code IS in the production bundle and
 * simply never executes. That is the honest claim; if the lanes must be absent
 * from the bundle rather than merely inert, this module has to go behind a
 * dynamic import or be reverted, and reverting is what should happen once the
 * question is answered.
 */

const TABLE = "session_requests";
const PREFIX = "[rt-diag]";

/** Lane labels, as they appear in the console and in the matrix above. */
type Lane = "A" | "B" | "C";

function isEnabled(): boolean {
  return process.env.NEXT_PUBLIC_RT_DIAG === "1";
}

/**
 * Milliseconds since the page's time origin — `performance.now()`, which is
 * monotonic and therefore cannot go backwards if the wall clock is adjusted
 * mid-run. The ordering of these numbers is the finding: lane A's
 * `subscribe() called` against `session available` is the whole of candidate
 * (b), readable from the console with nothing else to hand.
 */
function mark(): string {
  return `t+${performance.now().toFixed(1)}ms`;
}

function log(lane: Lane | "diag", message: string, detail?: unknown): void {
  const line = `${PREFIX} ${mark()} [${lane}] ${message}`;
  if (detail === undefined) {
    console.info(line);
    return;
  }
  console.info(line, detail);
}

/**
 * The document's cookies in `@supabase/ssr`'s `getAll` shape.
 *
 * Hand-rolled rather than importing `cookie`: it is a transitive dependency of
 * `@supabase/ssr`, not one this repo declares (SPEC §2, and CLAUDE.md's rule
 * about adding dependencies). Chunked-session reassembly and base64url
 * decoding still happen inside `@supabase/ssr` exactly as they do for the
 * production client — this only hands it the raw pairs.
 */
function readCookies(): { name: string; value: string }[] {
  if (typeof document === "undefined") return [];
  return document.cookie
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq === -1) return { name: pair, value: "" };
      return {
        name: decodeURIComponent(pair.slice(0, eq)),
        value: decodeURIComponent(pair.slice(eq + 1)),
      };
    });
}

/**
 * One Supabase client per lane, and deliberately NOT the app's singleton.
 *
 * `isSingleton: false` is what makes the lanes independent — without it all
 * three would be the same object as each other AND as the production
 * subscription, sharing one socket and one access token. `setAll` is a no-op
 * so nothing here can write the auth cookie; `autoRefreshToken: false` keeps
 * these clients out of refresh-token rotation (auth-js only refreshes at
 * recovery when that flag is on), and `detectSessionInUrl: false` stops them
 * competing with the real client to consume an OAuth code.
 */
function createDiagnosticClient(): SupabaseClient {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      isSingleton: false,
      cookies: {
        getAll: () => readCookies(),
        // Read-only, on purpose: see the note above.
        setAll: () => {},
      },
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

/** The columns the matrix needs. The row is evidence here, not display data. */
interface DiagRow {
  id?: string;
  tutor_id?: string;
  student_id?: string;
  status?: string;
}

/**
 * Attach the INSERT handler and subscribe, logging both sides of the handshake.
 *
 * `filter` omitted means no server-side binding at all — every INSERT the
 * subscriber is authorised to see. That is the point of lanes A and B: an
 * event that arrives unfiltered and not filtered convicts the filter binding.
 */
function openLane(
  lane: Lane,
  client: SupabaseClient,
  topic: string,
  tutorId: string,
  filter?: string,
): RealtimeChannel {
  const channel = client.channel(topic).on(
    "postgres_changes",
    filter
      ? { event: "INSERT", schema: "public", table: TABLE, filter }
      : { event: "INSERT", schema: "public", table: TABLE },
    (payload) => {
      const row = (payload.new ?? {}) as DiagRow;
      log(lane, "INSERT payload", {
        id: row.id ?? null,
        tutor_id: row.tutor_id ?? null,
        status: row.status ?? null,
        isForThisTutor: row.tutor_id === tutorId,
        topic,
      });
    },
  );

  log(lane, "subscribe() called", { topic, filter: filter ?? null });
  channel.subscribe((status, err) => {
    log(lane, `status ${status}`, { topic, error: err?.message ?? null });
  });

  return channel;
}

/**
 * Mount the diagnostic alongside the tutor's real subscription.
 *
 * Called unconditionally from `useIncomingSessionRequests` because hooks must
 * be — the gate is the first statement of the effect, so with the flag unset
 * nothing is constructed, no client exists and no socket is opened.
 */
export function useRealtimeDiagnostic(tutorId: string): void {
  React.useEffect(() => {
    if (!isEnabled() || !tutorId) return;

    // Distinct per lane AND per mount. Two channels that share a topic can
    // share a binding, which would defeat the entire point of running three.
    const nonce = Math.random().toString(36).slice(2, 8);
    log("diag", "enabled — opening three independent lanes", {
      tutorId,
      nonce,
      lanes: {
        A: "no await, no filter",
        B: "awaited auth + setAuth, no filter",
        C: "awaited auth + setAuth, filter tutor_id=eq",
      },
    });

    let disposed = false;
    const open: { client: SupabaseClient; channel: RealtimeChannel }[] = [];
    let sessionLogged = false;

    function track(client: SupabaseClient, channel: RealtimeChannel) {
      if (disposed) {
        void client.removeChannel(channel);
        void client.realtime.disconnect();
        return;
      }
      open.push({ client, channel });
    }

    // ---- Lane A — synchronous, exactly as production subscribes -----------
    // No await anywhere before `.subscribe()`. Its client applies the token
    // the same way the production one does (async `INITIAL_SESSION` →
    // `realtime.setAuth`), so the ONLY difference from the shipped tutor
    // channel is the missing filter.
    // Caught, not allowed to propagate: this effect runs inside the component
    // that owns the tutor's REAL subscription, and an instrument that can
    // crash the thing it is measuring is not an instrument. A lane that
    // cannot even be constructed says so in the console and the other two
    // carry on — the matrix is read per lane, so two lanes still narrow it.
    try {
      const clientA = createDiagnosticClient();
      track(clientA, openLane("A", clientA, `rt-diag-a-${nonce}`, tutorId));
    } catch (err: unknown) {
      log("A", "lane setup threw", { error: String(err) });
    }

    // ---- Lanes B and C — token first, then bind ---------------------------
    // Same setup, one variable apart: C adds the filter binding, B has none.
    // Both `await setAuth(...)` — it returns a promise, and subscribing before
    // it settles would reintroduce the ordering the lane exists to rule out.
    async function openAuthedLane(
      lane: Lane,
      filter?: string,
    ): Promise<void> {
      const client = createDiagnosticClient();
      const { data, error } = await client.auth.getSession();

      if (!sessionLogged) {
        sessionLogged = true;
        // Logged ONCE, and this is the line to read against lane A's
        // `subscribe() called`: it is the first moment the token was
        // obtainable at all. If lane A subscribed before this, it bound
        // without a JWT — which is candidate (b), stated as a timestamp.
        log("diag", "session available", {
          hasAccessToken: Boolean(data.session?.access_token),
          userId: data.session?.user.id ?? null,
          matchesTutorId: data.session?.user.id === tutorId,
          expiresAt: data.session?.expires_at ?? null,
          error: error?.message ?? null,
        });
      }

      const token = data.session?.access_token ?? null;
      if (token) {
        await client.realtime.setAuth(token);
        log(lane, "setAuth applied to socket");
      } else {
        log(lane, "NO access token — subscribing unauthenticated");
      }

      // Unmounted while the token was being read: close the socket this lane
      // opened rather than binding a channel nobody is listening to.
      if (disposed) {
        void client.realtime.disconnect();
        return;
      }
      track(
        client,
        openLane(
          lane,
          client,
          `rt-diag-${lane.toLowerCase()}-${nonce}`,
          tutorId,
          filter,
        ),
      );
    }

    void openAuthedLane("B").catch((err: unknown) => {
      log("B", "lane setup threw", { error: String(err) });
    });
    void openAuthedLane("C", `tutor_id=eq.${tutorId}`).catch((err: unknown) => {
      log("C", "lane setup threw", { error: String(err) });
    });

    return () => {
      disposed = true;
      for (const { client, channel } of open) {
        // Remove the channel AND close the socket. `removeChannel` alone
        // eventually disconnects an empty client, but a diagnostic that leaves
        // three sockets warm behind it would be warming the very tenant whose
        // cold-start behaviour is under investigation.
        void client.removeChannel(channel).finally(() => {
          void client.realtime.disconnect();
        });
      }
      open.length = 0;
      log("diag", "torn down");
    };
  }, [tutorId]);
}
