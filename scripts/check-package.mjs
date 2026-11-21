#!/usr/bin/env node
// Fails when the npm package would ship a file outside the allowlist, a file that looks like a
// secret or a local config dump, or content matching a well-known credential format. Runs in
// `npm run check`, so the manual `npm publish` (prepublishOnly) and CI both enforce it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Every shipped path must match one of these. */
export const ALLOWED = [
  /^dist\/.+/,
  /^skills\/.+/,
  /^integrations\/.+/,
  /^LICENSE$/,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^package\.json$/,
];

/** No shipped path may match any of these, even under an allowed directory. */
export const FORBIDDEN = [
  { pattern: /(^|\/)\.env($|[./])/, reason: "environment file" },
  { pattern: /\.(pem|key|p12|pfx|crt)$/i, reason: "key or certificate" },
  { pattern: /(^|\/)\.npmrc$/, reason: "npm credentials file" },
  { pattern: /(^|\/)\.mcp\.json$/, reason: "MCP config that may hold a key" },
  { pattern: /(^|\/)(coverage|tests?|node_modules)\//, reason: "test or build artefact" },
  { pattern: /(^|\/)id_(rsa|ed25519|ecdsa)/, reason: "SSH key" },
  { pattern: /\.(tgz|log)$/, reason: "tarball or log" },
  { pattern: /\.bak-/, reason: "setup backup file" },
];

/** High-confidence credential formats; long enough that docs examples like `sk-o…1234` pass. */
export const SECRET_CONTENT = [
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: "private key" },
  { pattern: /\bnpm_[A-Za-z0-9]{36}\b/, reason: "npm token" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, reason: "GitHub token" },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/, reason: "GitHub token" },
  { pattern: /\bsk-(?:or-v1-|proj-)?[A-Za-z0-9_-]{40,}\b/, reason: "API key (sk-…)" },
  { pattern: /\b(?:ts|apikey|nace_sk)_[A-Za-z0-9]{32,}\b/, reason: "API key" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: "AWS access key" },
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/, reason: "Google API key" },
  { pattern: /\bpplx-[A-Za-z0-9]{32,}\b/, reason: "Perplexity API key" },
  { pattern: /\bvck_[A-Za-z0-9]{24,}\b/, reason: "Vercel AI Gateway key" },
];

/**
 * Check a pack listing. `read` returns a shipped file's text (or undefined to skip it).
 * Returns one human-readable problem per offending path; empty means the package is clean.
 */
export function checkPackage(paths, read) {
  const problems = [];
  for (const path of paths) {
    if (!ALLOWED.some((pattern) => pattern.test(path))) {
      problems.push(`${path}: not in the package allowlist`);
      continue;
    }
    const forbidden = FORBIDDEN.find(({ pattern }) => pattern.test(path));
    if (forbidden) {
      problems.push(`${path}: looks like a ${forbidden.reason}`);
      continue;
    }
    const text = read(path);
    if (text === undefined) continue;
    const secret = SECRET_CONTENT.find(({ pattern }) => pattern.test(text));
    if (secret) problems.push(`${path}: contains something that looks like a ${secret.reason}`);
  }
  return problems;
}

function packListing(root) {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [entry] = JSON.parse(out);
  return entry.files.map((file) => file.path);
}

function main() {
  const root = join(fileURLToPath(import.meta.url), "..", "..");
  const paths = packListing(root);
  const problems = checkPackage(paths, (path) => {
    try {
      return readFileSync(join(root, path), "utf8");
    } catch {
      return undefined;
    }
  });
  if (problems.length > 0) {
    console.error(`✗ package contents: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  if (!paths.includes("dist/cli.js")) {
    console.error("✗ package contents: dist/cli.js is missing; run `npm run build` first");
    process.exit(1);
  }
  console.log(`✓ package contents: ${paths.length} files, all allowlisted, no secrets`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
