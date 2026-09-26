import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * The profile stage (design round 3 Part E). Asserted: the photo state shows
 * the photo, the heart and the live chip only when instant-available; the
 * overlay state carries LIVE and a "Watch live" link to the broadcast; the
 * embed state mounts the viewer stage with the broadcast and the viewer key.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));
vi.mock("@/actions/favourites", () => ({ toggleFavourite: vi.fn() }));
vi.mock("@/components/features/broadcasts/viewer-stage", () => ({
  ViewerStage: (props: { broadcastId: string; viewerKey: string }) => (
    <div data-testid="viewer-stage">
      {props.broadcastId}:{props.viewerKey}
    </div>
  ),
}));

import { ProfileStage } from "@/components/features/tutor/profile-stage";

const base = {
  tutorId: "t1",
  tutorName: "Liam Bennett",
  tutorSlug: "liam",
  avatarUrl: "https://example.supabase.co/storage/v1/object/public/avatars/liam.jpg",
  isFavourited: false,
  favouriteMode: "anon" as const,
  loginHref: "/login?next=/tutors/liam",
};

describe("ProfileStage", () => {
  it("photo: the picture and the heart, no status text when offline", () => {
    const { container } = render(<ProfileStage {...base} mode={{ kind: "photo" }} instantAvailable={false} />);
    const stage = container.querySelector("[data-stage]")!;
    expect(stage.getAttribute("data-stage")).toBe("photo");
    expect(within(stage as HTMLElement).getByRole("img", { name: /photo of liam/i })).toBeTruthy();
    expect(within(stage as HTMLElement).queryByText(/live/i)).toBeNull();
    expect(stage.className).not.toMatch(/ring-live/);
  });

  it("photo: the on-air ring and Live now when instant-available", () => {
    const { container } = render(<ProfileStage {...base} mode={{ kind: "photo" }} instantAvailable />);
    const stage = container.querySelector("[data-stage]")!;
    expect(stage.className).toMatch(/ring-live/);
    expect(within(stage as HTMLElement).getByText("Live now")).toBeTruthy();
  });

  it("overlay: LIVE and a Watch live link to the broadcast", () => {
    render(<ProfileStage {...base} mode={{ kind: "overlay", broadcastId: "b1" }} instantAvailable={false} />);
    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^watch live$/i }).getAttribute("href")).toBe("/live/b1");
    expect(screen.queryByTestId("viewer-stage")).toBeNull();
  });

  it("embed: mounts the viewer stage with the broadcast and the viewer key", () => {
    const { container } = render(
      <ProfileStage {...base} mode={{ kind: "embed", broadcastId: "b1", viewerKey: "42" }} instantAvailable={false} />,
    );
    expect(container.querySelector("[data-stage]")!.getAttribute("data-stage")).toBe("embed");
    expect(screen.getByTestId("viewer-stage").textContent).toBe("b1:42");
    expect(screen.queryByRole("link", { name: /^watch live$/i })).toBeNull();
  });
});
