#!/usr/bin/env node
// Keep every version field and every documented launch command aligned with package.json.
// npm runs it as the `version` lifecycle script; `node scripts/sync-version.mjs [root]` also works.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url));
const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const pinned = new RegExp(`${escaped}@\\d+\\.\\d+\\.\\d+[-\\w.]*`, "g");
const changed = [];

function sync(rel, transform) {
  const before = readFileSync(join(root, rel), "utf8");
  const after = transform(before);
  if (after !== before) {
    writeFileSync(join(root, rel), after);
    changed.push(rel);
  }
}

sync(".claude-plugin/plugin.json", (t) =>
  t.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`),
);
sync("skills/jev/SKILL.md", (t) => t.replace(/^(\s*version:\s*)"[^"]+"/m, `$1"${version}"`));
sync(".mcp.json", (t) => t.replace(new RegExp(`${escaped}(@[^"]+)?`), `${name}@${version}`));
const docs = readdirSync(join(root, "docs", "harnesses")).map((f) => join("docs", "harnesses", f));
for (const rel of ["README.md", ...docs]) sync(rel, (t) => t.replace(pinned, `${name}@${version}`));

console.log(
  changed.length
    ? `synced ${version} into ${changed.join(", ")}`
    : `everything already at ${version}`,
);
