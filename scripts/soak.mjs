// Soak runs from the command line (docs/testing/soak.md):
//   node scripts/soak.mjs --residents 300 --days 1 --walk [--seconds N] [--no-lod] [--seed N] [--budget ms] [--stuck s] [--no-build]
// Compiles the sim with the project's TypeScript (as npm test does), runs sim/soak.ts headless, prints the report and
// exits non-zero on any violation (stuck, items, place, roundTrip, budget).
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes(`--${k}`);
if (!flag("no-build")) {
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.test.json"], { stdio: "inherit" });
  mkdirSync(".test-out", { recursive: true });
  writeFileSync(".test-out/package.json", '{"type":"commonjs"}');
}
const { runSoak } = require("../.test-out/src/game/sim/soak.js");
const seconds = opt("seconds") ? Number(opt("seconds")) : undefined;
const report = runSoak({
  residents: Number(opt("residents", 300)), seconds, days: seconds ? undefined : Number(opt("days", 1)), walk: flag("walk"), lod: !flag("no-lod"),
  seed: Number(opt("seed", 1234)), budgetMs: Number(opt("budget", 4)), stuckSeconds: Number(opt("stuck", 45)), roundTripEvery: Number(opt("round-trip-every", 3600)),
  onProgress: (d, t) => process.stdout.write(`\r${Math.round((d / t) * 100)}%`),
});
console.log("\n" + JSON.stringify({ ...report, violations: report.violations.length }, null, 2));
for (const v of report.violations) console.log(`${v.kind} @ ${v.at.toFixed(1)} s: ${v.detail}`);
process.exit(report.ok ? 0 : 1);
