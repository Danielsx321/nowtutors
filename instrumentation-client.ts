import * as Sentry from "@sentry/nextjs";

// Browser translation (Chrome's built-in Google Translate) and some extensions
// swap React's text nodes for their own. When React later removes or inserts
// next to a node that is no longer where it left it, the DOM throws
// "removeChild / insertBefore: not a child of this node" and the page falls to
// the error screen (Sentry JAVASCRIPT-NEXTJS-10-8 and -A, Oct 2026). Skip the
// call in that one case instead of throwing, so translated pages keep working.
// This file runs before hydration, so the guard is in place before React is.
if (typeof Node === "function" && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child;
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) return newNode;
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}

// Client-side Sentry. The browser bundle cannot read the server-only
// SENTRY_DSN, so the client gates on the public NEXT_PUBLIC_SENTRY_DSN.
// Unset => no-op (nothing breaks locally or in preview).
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 1,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
