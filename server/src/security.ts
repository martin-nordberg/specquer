import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";

/**
 * Protection for a server that can edit files on the user's machine (see
 * documentation/specifications/security.md): loopback only, a session token, Host and Origin
 * checks, and a Content-Security-Policy for the page.
 */

export const LOOPBACK_HOST = "127.0.0.1";

/** 32 random bytes, base64url. */
export function generateToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** Constant-time comparison of a presented token with the session token. */
export function tokenMatches(presented: string | undefined, token: string): boolean {
  if (presented === undefined) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Cookies are shared between ports on the same host, so the name includes the port. */
export function sessionCookieName(port: number): string {
  return `specquer_session_${port}`;
}

export interface SecurityConfig {
  token: string;
  /** Read on each request, since the port is known only once the server listens. */
  port: () => number;
}

export function allowedHosts(port: number): string[] {
  return [`${LOOPBACK_HOST}:${port}`, `localhost:${port}`];
}

export function allowedOrigins(port: number): string[] {
  return allowedHosts(port).map((host) => `http://${host}`);
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Rejects requests whose Host isn't this server, against DNS rebinding. */
export function hostCheck(config: SecurityConfig): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host");
    if (host === undefined || !allowedHosts(config.port()).includes(host.toLowerCase())) {
      return c.text("Invalid Host header", 403);
    }
    await next();
  };
}

/** Whether the request carries the session cookie or a bearer token. */
export function authentication(c: Parameters<MiddlewareHandler>[0], config: SecurityConfig): "cookie" | "bearer" | undefined {
  const auth = c.req.header("authorization");
  if (auth?.startsWith("Bearer ") && tokenMatches(auth.slice(7), config.token)) return "bearer";
  if (tokenMatches(getCookie(c, sessionCookieName(config.port())), config.token)) return "cookie";
  return undefined;
}

/**
 * API protection: the session cookie or a bearer token on every request, and for state-changing
 * requests an Origin from this server (a non-browser client using a bearer token may omit it).
 */
export function apiGuard(config: SecurityConfig): MiddlewareHandler {
  return async (c, next) => {
    const auth = authentication(c, config);
    if (auth === undefined) return c.json({ error: "unauthorized", message: "Missing or invalid session" }, 401);
    if (STATE_CHANGING.has(c.req.method)) {
      const origin = c.req.header("origin");
      const allowed = origin === undefined ? auth === "bearer" : allowedOrigins(config.port()).includes(origin);
      if (!allowed) return c.json({ error: "forbidden", message: "Invalid Origin" }, 403);
    }
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
  };
}

/** SHA-256 hashes of the inline scripts in a page, for the CSP (Bun's dev server adds one). */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1] ?? "";
    if (body.trim() === "") continue;
    const digest = new Bun.CryptoHasher("sha256").update(body).digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

/**
 * The page's Content-Security-Policy (decision D11). CodeMirror and Milkdown inject styles;
 * in development the hot-reload client connects over a WebSocket.
 */
export function contentSecurityPolicy(options: { port: number; development: boolean; scriptHashes: string[] }): string {
  const ws = options.development ? allowedHosts(options.port).map((h) => ` ws://${h}`).join("") : "";
  return [
    "default-src 'self'",
    `script-src 'self'${options.scriptHashes.map((h) => ` ${h}`).join("")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self'${ws}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
