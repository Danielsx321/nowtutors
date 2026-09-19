/**
 * A PayPal address shown back to its owner without printing it in full
 * (live-globe rebuild Part F; the Part 0 mockup's masked emails):
 * "daniel.dada@gmail.com" → "d•••a@gmail.com". Enough to recognise, not
 * enough to copy off a shoulder-surfed screen. The domain stays whole: it is
 * what tells a tutor which account the money goes to.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const masked = local.length <= 2 ? `${local[0]}•••` : `${local[0]}•••${local[local.length - 1]}`;
  return `${masked}@${domain}`;
}
