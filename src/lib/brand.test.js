import { describe, expect, it } from "vitest";
import { brandInk, contrast, hexToRgb, initials } from "./brand.js";

describe("brand helpers", () => {
  it("parses hex colours, falling back on nonsense", () => {
    expect(hexToRgb("#2F5233")).toEqual([47, 82, 51]);
    expect(hexToRgb("fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("nope")).toEqual([47, 82, 51]);
  });
  it("keeps text readable on any brand colour", () => {
    for (const hex of ["#2F5233", "#1F4E79", "#0071e3", "#ffd60a", "#f5f5f7", "#8B6F47"]) {
      const [ink, other] = brandInk(hex) === "#ffffff" ? [[255, 255, 255], [29, 29, 31]] : [[29, 29, 31], [255, 255, 255]];
      const c = contrast(hexToRgb(hex), ink);
      expect(c >= 4.5 || c >= contrast(hexToRgb(hex), other)).toBe(true); // AA, or the better of the two
    }
    expect(brandInk("#2F5233")).toBe("#ffffff");
    expect(brandInk("#ffd60a")).toBe("#1d1d1f");
  });
  it("monogram initials skip filler words", () => {
    expect(initials("Placeholder Garden Services")).toBe("PG");
    expect(initials("The Green & Co")).toBe("GC");
    expect(initials("Verde")).toBe("V");
    expect(initials("")).toBe("?");
  });
});
