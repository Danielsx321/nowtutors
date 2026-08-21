import { redirectIfSignedIn } from "@/lib/auth/guards";
import { LoginForm } from "@/components/features/auth/login-form";

export const metadata = { title: "Log in · NowTutors" };

const ERRORS: Record<string, string> = {
  auth: "We couldn't sign you in. Please try again.",
  missing_code: "That sign-in link was invalid or expired.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectIfSignedIn();
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const err = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h2 font-bold text-gray-700">Welcome back</h1>
        <p className="text-body text-gray-500">
          Log in to book sessions and message tutors.
        </p>
      </div>
      <LoginForm next={next} initialError={err} />
    </div>
  );
}
