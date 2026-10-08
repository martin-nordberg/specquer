import { expect, test } from "bun:test";
import { isUid } from "./uids.ts";

test("UIDs are CUID2s: a lower-case letter, then lower-case letters and digits", () => {
  for (const uid of ["tz4a98xxat96", "tz4a98xxat96iws9zmbrgj3a", "ab"]) expect(isUid(uid)).toBe(true);
  for (const uid of ["", "a", "1abc", "Tz4a98", "tz4a-98", `a${"b".repeat(64)}`]) expect(isUid(uid)).toBe(false);
});
