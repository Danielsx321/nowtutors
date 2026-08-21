import { redirectIfSignedIn } from "@/lib/auth/guards";
import { SignupForm } from "@/components/features/auth/signup-form";

export const metadata = { title: "Sign up · NowTutors" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectIfSignedIn();
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-h2 font-bold text-gray-700">Create your account</h1>
        <p className="text-body text-gray-500">
          Learn from live tutors, or teach and earn.
        </p>
      </div>
      <SignupForm next={next} />
    </div>
  );
}
