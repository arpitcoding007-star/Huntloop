import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Avatar, isAvatarSrc } from "./TopBar";

/** Explicit cleanup, because `globals: false`. See the note in DataTable.test.tsx. */
afterEach(cleanup);

const upload = "data:image/jpeg;base64,/9j/4AAQ";

describe("Avatar", () => {
  it("shows initials without a picture", () => {
    const { container } = render(<Avatar initials="Ada Lovelace" />);
    expect(container.textContent).toBe("AL");
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the picture, decorative, when it is one it may draw", () => {
    const { container } = render(<Avatar initials="Ada Lovelace" src={upload} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(upload);
    expect(img.getAttribute("alt")).toBe("");
    expect(container.textContent).toBe("");
  });

  it("falls back to initials when the picture does not load", () => {
    const { container } = render(<Avatar initials="Ada Lovelace" src="https://example.com/gone.jpg" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.textContent).toBe("AL");
  });

  it("never draws a source outside the rule", () => {
    for (const src of ["javascript:alert(1)", "http://example.com/a.jpg", "data:image/svg+xml;base64,PHN2Zz4="]) {
      const { container, unmount } = render(<Avatar initials="Ada Lovelace" src={src} />);
      expect(container.querySelector("img")).toBeNull();
      unmount();
    }
  });
});

describe("isAvatarSrc", () => {
  it("matches the database rule (migration 0072)", () => {
    expect(isAvatarSrc("https://lh3.googleusercontent.com/a/x")).toBe(true);
    expect(isAvatarSrc(upload)).toBe(true);
    expect(isAvatarSrc("data:image/jpeg;base64," + "A".repeat(48_000))).toBe(false);
    expect(isAvatarSrc("https://x.test/" + "a".repeat(2048))).toBe(false);
    expect(isAvatarSrc(null)).toBe(false);
  });
});
