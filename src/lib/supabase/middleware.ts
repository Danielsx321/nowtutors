import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth session when it has expired and rewrites the cookies
 * onto the response, so Server Components always see a fresh, validated session
 * (the SSR pattern from the Supabase docs). Authorization/redirects are NOT done
 * here — that is Layer 2 in the layouts + actions (SPEC §5, lib/auth/guards).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims(). It reads the
  // session, refreshes the token if it has expired (the only network call, and
  // only then), and verifies the signature locally. This used to be getUser(),
  // an HTTP call to the auth server on every request, prefetch and heartbeat,
  // made from the edge nearest the visitor (performance review P1).
  await supabase.auth.getClaims();

  return response;
}
