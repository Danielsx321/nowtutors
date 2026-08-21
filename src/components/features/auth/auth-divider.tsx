/** "or" divider between OAuth and the email/password form. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1 bg-gray-200" />
      <span className="text-caption font-medium uppercase tracking-wide text-gray-500">
        or
      </span>
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  );
}
