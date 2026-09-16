/** "or" divider between OAuth and the email/password form. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      <span className="text-caption font-medium text-text-muted">
        or
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
