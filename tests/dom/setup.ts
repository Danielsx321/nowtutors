import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Unmount whatever the previous test rendered.
 *
 * `@testing-library/react` registers this itself when Vitest's globals are on;
 * this lane runs without globals (see `vitest.dom.config.ts`), so it is
 * registered by hand. Without it a `getByRole` in the next test can match a
 * node left in `document.body` by the last one — the modal under test here is a
 * portal, which is exactly the kind of node that outlives its test.
 */
afterEach(() => {
  cleanup();
});
