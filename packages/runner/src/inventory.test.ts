import { describe, expect, it } from "vitest";
import { ElementInventorySchema } from "@demoforge/shared";
import { toElementInventory, type PageInventory } from "./inventory.js";

describe("toElementInventory", () => {
  const snapshot: PageInventory = {
    url: "http://localhost:3100/signup",
    title: "Create your account",
    headings: ["Create your account"],
    truncated: false,
    elements: [
      { role: "textbox", name: "Email", tag: "input", type: "text", id: "email", placeholder: "you@example.com" },
      { role: null, name: "Password", tag: "input", type: "password" },
      { role: null, name: "Decorative", tag: "div" },
      { role: "button", name: "Create account", tag: "button", disabled: true },
    ],
  };

  it("maps the runtime snapshot to the shared { pages: [{ url, title, elements }] } shape", () => {
    const inv = toElementInventory(snapshot);
    expect(ElementInventorySchema.parse(inv)).toEqual(inv);
    expect(inv).toEqual({
      pages: [
        {
          url: "http://localhost:3100/signup",
          title: "Create your account",
          elements: [
            { role: "heading", name: "Create your account" },
            { role: "textbox", name: "Email", placeholder: "you@example.com" },
            { role: "textbox", name: "Password" }, // password inputs have no ARIA role: textbox + label
            { role: "button", name: "Create account" },
          ],
        },
      ],
    });
  });

  it("returns a valid empty page for an empty snapshot", () => {
    const inv = toElementInventory({ url: "about:blank", title: "", headings: [], elements: [], truncated: false });
    expect(ElementInventorySchema.parse(inv).pages[0]!.elements).toEqual([]);
  });
});
