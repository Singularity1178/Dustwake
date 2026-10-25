// Preview renders without a browser: compiles tests/ (as npm test does) and
// runs tests/preview.ts, which writes PNGs to .preview/. Pass view names to
// limit the work (e.g. `node scripts/preview.mjs views`).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

rmSync(".test-out", { recursive: true, force: true });
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.test.json"], { stdio: "inherit" });
mkdirSync(".test-out", { recursive: true });
writeFileSync(".test-out/package.json", '{"type":"commonjs"}');
const r = spawnSync(process.execPath, [".test-out/tests/preview.js", ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
