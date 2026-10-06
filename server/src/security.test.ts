import { afterAll, describe, expect, test } from "bun:test";
import { CliError, parseCli, resolveRoot } from "./cli.ts";
import { contentSecurityPolicy, generateToken, inlineScriptHashes, tokenMatches } from "./security.ts";
import { ORIGIN, TEST_PORT, TEST_TOKEN, tempRoot, testApp } from "./test-support.ts";

const { root, cleanup } = await tempRoot({ "a.md": "# A\n" });
afterAll(cleanup);
const { app, request } = testApp(root);
const host = `127.0.0.1:${TEST_PORT}`;

describe("token", () => {
  test("is 32 random bytes in base64url", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
  });

  test("comparison", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abd", "abc")).toBe(false);
    expect(tokenMatches("ab", "abc")).toBe(false);
    expect(tokenMatches(undefined, "abc")).toBe(false);
  });
});

describe("launch", () => {
  test("the token URL sets the session cookie and redirects without the token", async () => {
    const res = await app.request(`/?token=${TEST_TOKEN}`, { headers: { host } });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`specquer_session_${TEST_PORT}=${TEST_TOKEN}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  test("a wrong token or no session is rejected", async () => {
    expect((await app.request("/?token=wrong", { headers: { host } })).status).toBe(401);
    expect((await app.request("/", { headers: { host } })).status).toBe(401);
  });

  test("the page has a Content-Security-Policy with the inline script's hash", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self' 'sha256-");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("API protection", () => {
  test("requests without the session are rejected", async () => {
    expect((await app.request("/api/tree", { headers: { host } })).status).toBe(401);
    expect((await request("/api/tree", { headers: { cookie: "specquer_session_4999=wrong" } })).status).toBe(401);
  });

  test("a bearer token works for non-browser clients", async () => {
    const res = await app.request("/api/tree", { headers: { host, authorization: `Bearer ${TEST_TOKEN}` } });
    expect(res.status).toBe(200);
    const patch = await app.request("/api/uistate", {
      method: "PATCH",
      headers: { host, authorization: `Bearer ${TEST_TOKEN}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(patch.status).toBe(200);
  });

  test.each(["evil.example:4999", "127.0.0.1:5000", "localhost"])("Host %p is rejected", async (badHost) => {
    expect((await request("/api/tree", { headers: { host: badHost } })).status).toBe(403);
    expect((await request("/", { headers: { host: badHost } })).status).toBe(403);
  });

  test("localhost is an accepted Host", async () => {
    expect((await request("/api/tree", { headers: { host: `localhost:${TEST_PORT}` } })).status).toBe(200);
  });

  test("state-changing requests need this server's Origin", async () => {
    const patch = (origin?: string) =>
      request("/api/uistate", { method: "PATCH", body: {}, headers: origin === undefined ? { origin: "" } : { origin } });
    expect((await patch("http://evil.example")).status).toBe(403);
    expect((await patch(`http://127.0.0.1:${TEST_PORT + 1}`)).status).toBe(403);
    expect((await patch("")).status).toBe(403);
    expect((await patch(ORIGIN)).status).toBe(200);
    expect((await patch(`http://localhost:${TEST_PORT}`)).status).toBe(200);
  });

  test("API responses aren't cached", async () => {
    expect((await request("/api/tree")).headers.get("cache-control")).toBe("no-store");
  });
});

test("CSP allows the hot-reload WebSocket only in development", () => {
  expect(contentSecurityPolicy({ port: 1, development: true, scriptHashes: [] })).toContain("ws://127.0.0.1:1");
  expect(contentSecurityPolicy({ port: 1, development: false, scriptHashes: [] })).not.toContain("ws:");
});

test("inline script hashes skip external scripts", () => {
  const html = '<script src="/a.js"></script><script type="module" crossorigin src="/b.js"></script><script>x()</script>';
  expect(inlineScriptHashes(html)).toEqual([`'sha256-${new Bun.CryptoHasher("sha256").update("x()").digest("base64")}'`]);
});

describe("command line", () => {
  test("defaults", () => {
    expect(parseCli([])).toEqual({ root: ".", port: undefined, open: true });
  });

  test("root, port and --no-open", () => {
    expect(parseCli(["specs", "--port", "4000", "--no-open"])).toEqual({ root: "specs", port: 4000, open: false });
  });

  test.each([[["--port", "x"]], [["--port", "70000"]], [["a", "b"]], [["--bogus"]]])("rejects %p", (args: string[]) => {
    expect(() => parseCli(args)).toThrow(CliError);
  });

  test("the root must be an existing folder", async () => {
    expect(await resolveRoot(".", root)).toBe(root);
    expect(resolveRoot("missing", root)).rejects.toThrow(CliError);
    expect(resolveRoot("a.md", root)).rejects.toThrow(CliError);
  });
});
