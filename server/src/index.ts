import { Hono } from "hono";
import client from "@specquer/client/index.html";

// Placeholder until the shared router exists in @specquer/shared
const app = new Hono();

// Bun bundles the client from its HTML entry point: on each request (with hot
// reloading) in development, and into the executable by `bun build --compile`
const server = Bun.serve({
  port: 3000,
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/": client,
  },
  // Everything that isn't a client route goes to Hono
  fetch: app.fetch,
});

console.log(`Specquer running at ${server.url}`);
