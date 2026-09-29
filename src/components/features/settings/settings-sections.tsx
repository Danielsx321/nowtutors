import "server-only";
import * as React from "react";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { getVerifiedUser } from "@/lib/auth/guards";
import { readPreferences } from "@/lib/email/preferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountForm } from "./account-form";
import { NotificationForm } from "./notification-form";
import { PasswordForm } from "./password-form";

/**
 * The cards both settings pages share (SPEC §6; Phase 10 Part 4): account,
 * email notifications, password, and how to close an account. `/tutor/settings`
 * adds its Payouts card after these.
 *
 * Closing an account is a note, not a button: deleting a user cascades through
 * bookings, the ledger and earnings, which is a money decision nobody has
 * taken yet (DECISIONS, Part 4).
 */
export async function SettingsSections({ userId, role }: { userId: string; role: "student" | "tutor" }) {
  const [row] = await db
    .select({
      displayName: profiles.displayName,
      fullName: profiles.fullName,
      timezone: profiles.timezone,
      prefs: profiles.notificationPreferences,
      email: profiles.email,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  const authUser = await getVerifiedUser();
  const providers =
    authUser?.app_metadata?.providers ?? authUser?.identities?.map((i) => i.provider) ?? [];
  const hasPassword = (providers as string[]).includes("email");
  const prefs = readPreferences(row?.prefs);
  const supportAddress = process.env.EMAIL_REPLY_TO?.trim() || null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle as="h2">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-small text-text-muted">
            Signed in as <span className="font-medium text-text">{row?.email ?? authUser?.email}</span>.
            {role === "tutor" ? (
              <>
                {" "}
                Your name and photo are on{" "}
                <Link href="/tutor/profile" className="focus-ring rounded-sm text-accent underline">
                  your profile
                </Link>
                .
              </>
            ) : null}
          </p>
          <AccountForm
            showName={role === "student"}
            displayName={row?.displayName ?? row?.fullName ?? null}
            timezone={row?.timezone ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Email notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationForm
            initial={{
              booking_confirmations: prefs.booking_confirmations,
              reminders: prefs.reminders,
              messages: prefs.messages,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Password</CardTitle>
        </CardHeader>
        <CardContent>
          <PasswordForm hasPassword={hasPassword} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Close your account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-body text-text-muted">
            {supportAddress ? (
              <>
                To close your account, email{" "}
                <a href={`mailto:${supportAddress.replace(/^.*<([^>]+)>.*$/, "$1")}`} className="focus-ring rounded-sm text-accent underline">
                  {supportAddress.replace(/^.*<([^>]+)>.*$/, "$1")}
                </a>{" "}
                from the address you sign in with.
              </>
            ) : (
              <>To close your account, contact NowTutors support from the address you sign in with.</>
            )}{" "}
            {role === "tutor"
              ? "Withdraw any available earnings first."
              : "Credits left in your wallet can't be paid out, so use them first."}
          </p>
        </CardContent>
      </Card>
    </>
  );
}
