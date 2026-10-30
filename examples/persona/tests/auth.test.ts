import { describe, expect, it } from "vitest";
import { basicAuth } from "../src/auth";

describe("basicAuth", () => {
  it("returns null for valid credentials", () => {
    const req = new Request("http://x/", {
      headers: { authorization: "Basic " + btoa("user:secret") },
    });
    expect(basicAuth(req, "secret")).toBeNull();
  });
  it("returns 401 for missing header", () => {
    const req = new Request("http://x/");
    const res = basicAuth(req, "secret");
    expect(res?.status).toBe(401);
  });
  it("returns 401 for malformed base64", () => {
    const req = new Request("http://x/", {
      headers: { authorization: "Basic !!!notbase64!!!" },
    });
    const res = basicAuth(req, "secret");
    expect(res?.status).toBe(401);
  });
  it("returns 401 for wrong password", () => {
    const req = new Request("http://x/", {
      headers: { authorization: "Basic " + btoa("user:wrong") },
    });
    const res = basicAuth(req, "secret");
    expect(res?.status).toBe(401);
  });
  it("returns 401 for empty password", () => {
    const req = new Request("http://x/", {
      headers: { authorization: "Basic " + btoa("user:") },
    });
    const res = basicAuth(req, "");
    expect(res?.status).toBe(401);
  });
  it("returns 401 for non-basic auth", () => {
    const req = new Request("http://x/", {
      headers: { authorization: "Bearer token" },
    });
    const res = basicAuth(req, "secret");
    expect(res?.status).toBe(401);
  });
});
