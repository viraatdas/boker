import { describe, expect, test } from "vitest";
import { parseJsonColumn } from "../src/repository";

describe("parseJsonColumn", () => {
  test("returns parsed objects unchanged", () => {
    const value = { ok: true };
    expect(parseJsonColumn(value)).toEqual(value);
  });

  test("parses json strings", () => {
    expect(parseJsonColumn<{ ok: boolean }>("{\"ok\":true}")).toEqual({ ok: true });
  });

  test("returns null for nullish values", () => {
    expect(parseJsonColumn(null)).toBeNull();
    expect(parseJsonColumn(undefined)).toBeNull();
  });
});
