import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * `/tutors` and `/` render the same browse view (SPEC §6/§7.2). `/` is canonical
 * (the homepage should render, not redirect); `/tutors` forwards here, preserving
 * any filter query so shared /tutors URLs keep working.
 */
export default async function TutorsRedirect({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach((x) => params.append(k, x));
    else if (v != null) params.append(k, v);
  }
  const qs = params.toString();
  redirect(qs ? `/?${qs}` : "/");
}
