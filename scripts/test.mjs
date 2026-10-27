// Headless simulation tests: compile tests (and the DOM-free modules they
// import) to CommonJS with the project's TypeScript, then run them with Node's
// built-in test runner. No browser, canvas or extra dependencies.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

rmSync(".test-out", { recursive: true, force: true });
const require = createRequire(import.meta.url);
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.test.json"], { stdio: "inherit" });
mkdirSync(".test-out", { recursive: true });
writeFileSync(".test-out/package.json", '{"type":"commonjs"}');
const dir = ".test-out/tests";
const files = readdirSync(dir).filter((f) => f.endsWith(".test.js")).map((f) => join(dir, f));
const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
