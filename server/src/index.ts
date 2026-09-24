import { Hono } from "hono";

// Placeholder until the shared router exists in @specquer/shared
const app = new Hono();

export default {
  port: 3000,
  fetch: app.fetch,
};
