// Release build: a single executable with the client bundled and embedded.
// The `bun build` CLI can't load bundler plugins, so the build runs through Bun.build()
// to apply the Tailwind plugin to the client's HTML import (decision D1).
import tailwind from "bun-plugin-tailwind";

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  compile: { outfile: "./dist/specquer" },
  minify: true,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [tailwind],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(`Built ${result.outputs.map((o) => o.path).join(", ")}`);
