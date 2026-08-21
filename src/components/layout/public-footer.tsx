import Link from "next/link";

const columns: { heading: string; links: { label: string; href: string }[] }[] =
  [
    {
      heading: "Learn",
      links: [
        { label: "Find tutors", href: "/tutors" },
        { label: "Live now", href: "/live" },
        { label: "How it works", href: "/how-it-works" },
        { label: "Pricing", href: "/pricing" },
      ],
    },
    {
      heading: "Company",
      links: [
        { label: "FAQ", href: "/faq" },
        { label: "Terms", href: "/legal/terms" },
        { label: "Privacy", href: "/legal/privacy" },
      ],
    },
    {
      heading: "Get started",
      links: [
        { label: "Sign up", href: "/signup" },
        { label: "Log in", href: "/login" },
        { label: "Teach on NowTutors", href: "/signup" },
      ],
    },
  ];

export function PublicFooter() {
  return (
    <footer className="border-t border-ink-700 bg-ink-1000">
      <div className="container-page grid gap-8 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div className="space-y-3">
          <p className="text-h3 font-bold text-white">
            Now<span className="text-gold-400">Tutors</span>
          </p>
          <p className="max-w-xs text-small text-white">
            Live tutoring, on demand. Find a tutor and start learning now.
          </p>
        </div>
        {columns.map((col) => (
          <nav key={col.heading} aria-label={col.heading} className="space-y-3">
            <p className="text-caption font-medium uppercase tracking-wide text-white">
              {col.heading}
            </p>
            <ul className="space-y-2">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="focus-ring-on-ink rounded-sm text-small text-white hover:text-gold-400 hover:underline"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-ink-700">
        <div className="container-page flex flex-col items-center justify-between gap-2 py-4 text-caption text-white sm:flex-row">
          <p>© {new Date().getFullYear()} NowTutors. All rights reserved.</p>
          <p>Made for learners everywhere.</p>
        </div>
      </div>
    </footer>
  );
}
