import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidSignature } from "../src/signature";

const SECRET = "app-secret";
const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

describe("isValidSignature", () => {
  it("accepts a signature made with the app secret", () => {
    expect(isValidSignature('{"a":1}', sign('{"a":1}'), SECRET)).toBe(true);
  });
  it("rejects a signature made with another secret", () => {
    expect(isValidSignature("body", sign("body", "other"), SECRET)).toBe(false);
  });
  it("rejects a tampered body", () => {
    expect(isValidSignature("world", sign("hello"), SECRET)).toBe(false);
  });
  it("rejects a missing header", () => {
    expect(isValidSignature("hello", null, SECRET)).toBe(false);
  });
  it("rejects a malformed header", () => {
    expect(isValidSignature("hello", "not-a-signature", SECRET)).toBe(false);
  });
});
