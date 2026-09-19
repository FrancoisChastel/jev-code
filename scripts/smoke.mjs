#!/usr/bin/env node
// Smoke test for the built CLI: help, version, and a real MCP handshake over stdio.
import { spawn } from "node:child_process";
import { once } from "node:events";

const cli = new URL("../dist/cli.js", import.meta.url).pathname;

async function run(args, input) {
  const child = spawn(process.execPath, [cli, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TYPESAFE_API_KEY: "" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (c) => {
    stdout += c;
  });
  child.stderr.on("data", (c) => {
    stderr += c;
  });
  if (input) child.stdin.write(input);
  child.stdin.end();
  const [code] = await once(child, "close");
  return { code, stdout, stderr };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

const help = await run(["--help"]);
assert(help.code === 0 && help.stdout.includes("Usage"), "help prints usage");

const version = await run(["version"]);
assert(version.code === 0 && /\d+\.\d+\.\d+/.test(version.stdout), "version prints a semver");

const noKey = await run(["check", "--json", '{"state":"x","checks":{"a":"q"}}']);
assert(
  noKey.code === 2 && noKey.stderr.includes("TYPESAFE_API_KEY"),
  "tool commands fail clearly without a key",
);

const messages = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "smoke", version: "0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
];
const mcp = await run(["mcp"], `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`);
const replies = mcp.stdout
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const list = replies.find((r) => r.id === 2);
const names = (list?.result?.tools ?? []).map((t) => t.name);
assert(
  names.length === 5 && names.includes("jev_classify"),
  `MCP server lists 5 tools over stdio (${names.join(", ")})`,
);
assert(mcp.code === 0, "MCP server exits cleanly when stdin closes");
