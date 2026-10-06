import { describe, expect, it } from "vitest";
import {
  centsToDecimalString,
  fromCents,
  fromQtyMilli,
  makeCentsFormatter,
  multiplyCents,
  sumCents,
  toCents,
  toQtyMilli,
} from "./money.js";

describe("toCents", () => {
  it.each([
    ["85", 8500],
    ["85.5", 8550],
    ["1250.50", 125050],
    ["1250,50", 125050], // en-ZA decimal comma
    ["1,250.50", 125050], // thousands comma with a dot
    ["1 250,50", 125050],
    ["R 85", 0], // not a number: currency symbols aren't accepted
    [".5", 50],
    ["7.", 700],
    [1999.99, 199999],
    [0.1 + 0.2, 30], // the classic float error doesn't leak through
    [1.005, 101], // 1.005 is 1.00499999… as a double; we still read 1.005
    ["", 0],
    [null, 0],
    [undefined, 0],
    ["abc", 0],
    ["1.2.3", 0],
    [NaN, 0],
    [Infinity, 0],
  ])("%j -> %i", (input, cents) => {
    expect(toCents(input)).toBe(cents);
  });

  it("always returns an integer", () => {
    for (const v of ["0.1", "0.2", "0.3", "19.999", 0.07, 4.35, 1.15]) {
      expect(Number.isInteger(toCents(v))).toBe(true);
    }
  });
});

describe("rounding: half away from zero", () => {
  it.each([
    ["0.005", 1],
    ["0.004", 0],
    ["0.0049999", 0],
    ["0.0050001", 1],
    ["2.675", 268], // Math.round(2.675 * 100) gives 267 with floats
    ["1.015", 102],
    ["-0.005", -1],
    ["-2.675", -268],
    ["-0.004", 0],
  ])("%s -> %i cents", (input, cents) => {
    expect(toCents(input)).toBe(cents);
  });
});

describe("multiplyCents (qty × rate)", () => {
  it.each([
    [40, "85", 340000], // 40 m² × R85
    ["12.5", "85", 106250], // 12.5 m² × R85
    [3, "0.10", 30], // 3 × R0.10 = R0.30 (floats give 0.30000000000000004)
    ["0.333", "100", 3330],
    ["1.5", "0.15", 23], // 22.5c -> 23c
    ["0.5", "0.01", 1], // 0.5c -> 1c
    ["0.4", "0.01", 0], // 0.4c -> 0c
    [2, "1250.5", 250100],
    ["12.3456", "10", 12346], // qty kept to 3 decimals: 12.346 × R10 = R123.46
    [0, "85", 0],
    ["", "85", 0],
  ])("%j × %j -> %i cents", (qty, rate, cents) => {
    expect(multiplyCents(qty, rate)).toBe(cents);
  });

  it("handles large jobs without overflow", () => {
    // 100 000 m² × R99 999.99 = R9 999 999 000.00
    expect(multiplyCents("100000", "99999.99")).toBe(999_999_900_000);
  });
});

describe("conversions back out", () => {
  it.each([
    [199999, "1999.99"],
    [5, "0.05"],
    [0, "0.00"],
    [-5, "-0.05"],
    [-12345, "-123.45"],
    [100, "1.00"],
  ])("%i -> %s", (cents, str) => {
    expect(centsToDecimalString(cents)).toBe(str);
    expect(toCents(fromCents(cents))).toBe(cents); // round-trips exactly
  });

  it("quantities round-trip", () => {
    expect(fromQtyMilli(toQtyMilli("12.5"))).toBe(12.5);
    expect(fromQtyMilli(toQtyMilli("0,25"))).toBe(0.25);
    expect(fromQtyMilli(toQtyMilli("3"))).toBe(3);
  });

  it("sums integers", () => {
    expect(sumCents([10, 20, 30])).toBe(60);
    expect(sumCents([])).toBe(0);
  });

  it("formats ZAR for display", () => {
    const fmt = makeCentsFormatter("ZAR");
    const clean = (s) => s.replace(/[  ]/g, " ");
    expect(clean(fmt(790129))).toBe("R 7 901,29");
    expect(clean(fmt(30))).toBe("R 0,30");
  });
});
