import { requireRole } from "@/lib/auth/guards";
import { GuideArticle } from "@/components/features/guide/guide-article";

export const metadata = { title: "Tutor guide · NowTutors" };

/**
 * `/tutor/guide`: the tutor guide inside the tutor app shell, "Guide" in the
 * sidebar. Requires approval like every tutor page (§5 Layer 2): the sidebar
 * around it links to pages an applicant can't open yet, which is the reason
 * `/tutor/pending-approval` lives in its own group. An applicant reads the
 * same guide as the PDF linked from the pending page.
 */
export default async function TutorGuidePage() {
  await requireRole("tutor");
  return <GuideArticle />;
}
