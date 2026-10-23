import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

/**
 * Security D (2026-10-23): the Turnstile widget. Nothing at all without a site
 * key (local dev, CI); with one, a reserved-height container the widget is
 * rendered into, a hidden `captchaToken` field, and a token that is cleared
 * on expiry, error and reset. The Turnstile global is mocked; the script tag
 * itself is `next/script`'s job and is checked against a real build instead.
 */

vi.mock("next/script", () => ({ default: () => null }));

import { Turnstile, type TurnstileApi, type TurnstileHandle } from "@/components/features/auth/turnstile";

type Opts = Parameters<TurnstileApi["render"]>[1];
let opts: Opts | undefined;
const api = {
  render: vi.fn((_el: HTMLElement, o: Opts) => {
    opts = o;
    return "w1";
  }),
  reset: vi.fn(),
  remove: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  opts = undefined;
  window.turnstile = api;
});
afterEach(() => {
  delete window.turnstile;
});

describe("Turnstile", () => {
  it("renders nothing without a site key and never touches the global", () => {
    const onToken = vi.fn();
    const { container } = render(<Turnstile siteKey="" onToken={onToken} />);
    expect(container.innerHTML).toBe("");
    expect(api.render).not.toHaveBeenCalled();
    expect(onToken).not.toHaveBeenCalled();
  });

  it("with a key, renders a reserved container into which the widget is drawn", () => {
    render(<Turnstile siteKey="1x00000000000000000000AA" action="login" onToken={vi.fn()} />);
    const box = screen.getByRole("group", { name: "Security check" });
    expect(box.style.minHeight).toBe("65px");
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(api.render.mock.calls[0]![0]).toBe(box);
    expect(opts).toMatchObject({
      sitekey: "1x00000000000000000000AA",
      theme: "light",
      action: "login",
      "response-field": false,
    });
    const hidden = document.querySelector<HTMLInputElement>('input[type="hidden"][name="captchaToken"]');
    expect(hidden?.value).toBe("");
  });

  it("publishes the token, clears it on expiry and error, and reset asks for a fresh one", () => {
    const onToken = vi.fn();
    const ref = React.createRef<TurnstileHandle>();
    render(<Turnstile ref={ref} siteKey="1x00000000000000000000AA" onToken={onToken} />);
    const hidden = () => document.querySelector<HTMLInputElement>('input[name="captchaToken"]')!.value;

    act(() => opts!.callback!("tok-1"));
    expect(onToken).toHaveBeenLastCalledWith("tok-1");
    expect(hidden()).toBe("tok-1");

    act(() => opts!["expired-callback"]!());
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(hidden()).toBe("");

    act(() => {
      opts!["error-callback"]!("300010");
    });
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("status").textContent).toMatch(/didn't load/);

    act(() => opts!.callback!("tok-2"));
    expect(screen.getByRole("status").textContent).toBe("");
    act(() => ref.current!.reset());
    expect(api.reset).toHaveBeenCalledWith("w1");
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it("removes its widget on unmount", () => {
    const { unmount } = render(<Turnstile siteKey="1x00000000000000000000AA" onToken={vi.fn()} />);
    unmount();
    expect(api.remove).toHaveBeenCalledWith("w1");
  });
});
