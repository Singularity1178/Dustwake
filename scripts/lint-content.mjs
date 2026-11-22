// The content linter from the command line (docs/testing/soak.md): node scripts/lint-content.mjs [rule ...]
// Prints every issue and exits non-zero if there is any. `npm test` requires zero issues too.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.test.json"], { stdio: "inherit" });
mkdirSync(".test-out", { recursive: true });
writeFileSync(".test-out/package.json", '{"type":"commonjs"}');
const { lintContent, RULES } = require("../.test-out/src/game/sim/contentLint.js");
const only = process.argv.slice(2);
const issues = lintContent(only.length ? only : undefined);
for (const i of issues) console.log(`${i.rule.padEnd(8)} ${i.table}/${i.row}: ${i.problem}`);
console.log(`${issues.length} issue(s) from ${only.length ? only.join(", ") : RULES.map((r) => r.id).join(", ")}`);
process.exit(issues.length ? 1 : 0);
