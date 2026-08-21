import { redirectIfSignedIn } from "@/lib/auth/guards";
import { ForgotPasswordForm } from "@/components/features/auth/forgot-password-form";

export const metadata = { title: "Reset your password · NowTutors" };

export default async function ForgotPasswordPage() {
  await redirectIfSignedIn();
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h2 font-bold text-gray-700">Reset your password</h1>
        <p className="text-body text-gray-500">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
