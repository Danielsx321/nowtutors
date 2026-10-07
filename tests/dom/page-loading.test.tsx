import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PageLoading } from "@/components/layout/page-loading";
import PublicLoading from "@/app/(public)/loading";
import AuthLoading from "@/app/(auth)/loading";
import PendingLoading from "@/app/(tutor-pending)/loading";

/**
 * The loading ring under `SiteShell` fills the screen below the header, so the
 * footer stays under the fold until the page streams in (CLS 0.20 on `/tutors`
 * mobile, 2026-10-07). Inside the app shells, which have no footer, it keeps
 * the half-screen height.
 */

afterEach(cleanup);

const frame = () => screen.getByRole("status").parentElement as HTMLElement;

describe("PageLoading", () => {
  it("keeps the half-screen height by default", () => {
    render(<PageLoading />);
    expect(frame().className).toContain("min-h-[50vh]");
  });

  it("fills the screen below the site header with `site`", () => {
    render(<PageLoading site />);
    expect(frame().className).toContain("min-h-[calc(100dvh-3.5rem)]");
    expect(frame().className).not.toContain("min-h-[50vh]");
  });

  it.each([
    ["(public)", PublicLoading],
    ["(auth)", AuthLoading],
    ["(tutor-pending)", PendingLoading],
  ])("the %s area uses the full-screen ring", (_area, Loading) => {
    render(<Loading />);
    expect(frame().className).toContain("min-h-[calc(100dvh-3.5rem)]");
  });
});
