import Link from "next/link";
import { GraduationCap } from "lucide-react";

/**
 * Public auth shell — a centered card on the light surface (SPEC §6, §10). Auth
 * pages are public; per-page server logic redirects an already-signed-in user.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="container-page py-6">
        <Link
          href="/"
          className="focus-ring inline-flex items-center gap-2 rounded-sm text-h3 font-bold text-gray-700"
        >
          <GraduationCap className="size-6 text-purple-500" aria-hidden />
          NowTutors
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
