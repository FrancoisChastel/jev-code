#!/usr/bin/env node
// Validates skills/*/SKILL.md against the Agent Skills specification (agentskills.io).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../skills/", import.meta.url).pathname;
let failures = 0;

const fail = (skill, message) => {
  failures += 1;
  console.error(`✗ ${skill}: ${message}`);
};

for (const name of readdirSync(root)) {
  const dir = join(root, name);
  if (!statSync(dir).isDirectory()) continue;
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) {
    fail(name, "SKILL.md is missing");
    continue;
  }
  const text = readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) {
    fail(name, "no YAML frontmatter");
    continue;
  }
  const [, front, body] = match;
  const field = (key) => {
    const line = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front);
    if (!line) return undefined;
    if (/^>-?\s*$/.test(line[1])) {
      const rest = front.slice(line.index + line[0].length);
      const block = rest
        .split("\n")
        .slice(1)
        .filter((l) => /^\s+\S/.test(l));
      const stop = block.findIndex((l) => !/^\s+/.test(l));
      return (stop === -1 ? block : block.slice(0, stop)).map((l) => l.trim()).join(" ");
    }
    return line[1].trim();
  };
  const skillName = field("name");
  const description = field("description");
  if (!skillName) fail(name, "frontmatter.name is required");
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName) || skillName.length > 64)
      fail(name, `invalid name "${skillName}"`);
    if (skillName !== name) fail(name, `name "${skillName}" must match directory "${name}"`);
  }
  if (!description) fail(name, "frontmatter.description is required");
  else if (description.length > 1024)
    fail(name, `description is ${description.length} chars (max 1024)`);
  const compatibility = field("compatibility");
  if (compatibility && compatibility.length > 500) fail(name, "compatibility exceeds 500 chars");
  const lines = body.split("\n").length;
  if (lines > 500) fail(name, `body is ${lines} lines (keep under 500)`);
  for (const link of body.matchAll(/\]\(((?:references|scripts|assets)\/[^)#]+)\)/g)) {
    if (!existsSync(join(dir, link[1]))) fail(name, `broken link ${link[1]}`);
  }
  if (!failures)
    console.log(`✓ ${name}: name ok, description ${description.length} chars, body ${lines} lines`);
}

process.exit(failures ? 1 : 0);
