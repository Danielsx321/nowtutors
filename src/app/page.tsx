import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ink-900 px-5 text-white">
      <span className="inline-flex items-center gap-2 rounded-full bg-purple-100 px-3 py-1 text-sm font-medium text-purple-700">
        <span className="size-2 rounded-full bg-live-500" aria-hidden />
        Phase 0 — Foundation
      </span>

      <h1 className="text-center text-4xl font-bold leading-tight sm:text-5xl">
        Now<span className="text-gold-400">Tutors</span>
      </h1>

      <p className="max-w-md text-center text-gray-200">
        The coded rebuild scaffold is live. The design system and product
        features arrive in later phases.
      </p>

      <Link
        href="/"
        className="rounded-md bg-gold-400 px-5 py-2.5 font-semibold text-ink-900 transition-colors hover:bg-purple-700 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
      >
        Get started
      </Link>
    </main>
  );
}
