import { notFound } from "next/navigation";

/**
 * Dev-only surface (kitchen sink, component previews). Chrome-free — it sits
 * outside the public and authenticated shells. Hidden in production so the
 * component gallery never ships to real users.
 */
export default function DevLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  return <>{children}</>;
}
