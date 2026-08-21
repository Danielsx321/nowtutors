import Link from "next/link";
import { getUser } from "@/lib/auth/guards";
import { ResetPasswordForm } from "@/components/features/auth/reset-password-form";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Set a new password · NowTutors" };

/**
 * Reached from a password-reset email → /auth/callback establishes the recovery
 * session → here. NOT guarded by redirectIfSignedIn (the recovery session is a
 * legitimate signed-in state). No session → the link expired.
 */
export default async function ResetPasswordPage() {
  const user = await getUser();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h2 font-bold text-gray-700">Set a new password</h1>
        <p className="text-body text-gray-500">
          Choose a new password for your account.
        </p>
      </div>
      {user ? (
        <ResetPasswordForm />
      ) : (
        <Alert variant="warning" title="This reset link has expired">
          <p>
            Request a new one from the{" "}
            <Link href="/forgot-password" className="font-medium underline">
              forgot password
            </Link>{" "}
            page.
          </p>
        </Alert>
      )}
    </div>
  );
}
