import { requireRole } from "@/lib/auth/guards";
import { listAdminSubjects } from "@/db/queries/admin-subjects";
import { SubjectManager } from "@/components/features/admin/subject-manager";

export const metadata = { title: "Subjects · NowTutors" };
export const dynamic = "force-dynamic";

/**
 * `/admin/subjects` (SPEC §4.1, §6; Phase 8 Part 5): add, rename, hide and show
 * subjects. A hidden subject drops out of browse, onboarding and the tutor
 * profile editor; tutors who already teach it keep it. The slug never changes
 * and nothing is deleted. `requireRole('admin')` first (§5 Layer 2).
 */
export default async function AdminSubjectsPage() {
  await requireRole("admin");
  const subjects = await listAdminSubjects();
  const hidden = subjects.filter((s) => !s.isActive).length;

  return (
    <div className="w-full space-y-6 py-2">
      <div>
        <h1 className="text-h1 font-bold text-gray-700">Subjects</h1>
        <p className="mt-1 text-body text-gray-500">
          {subjects.length} subjects{hidden ? `, ${hidden} hidden` : ""}. Renaming changes the label, never the
          link. Hiding removes a subject from pickers without touching tutors who already teach it.
        </p>
      </div>
      <SubjectManager subjects={subjects} />
    </div>
  );
}
