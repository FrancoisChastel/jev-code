import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { JevClient } from "../../src/core/client.js";
import { createJevMcpServer } from "../../src/mcp/server.js";
import { clientWith, noul } from "../helpers.js";

async function connect(clientFactory?: () => JevClient) {
  const server = createJevMcpServer({ clientFactory, version: "0.0.0-test" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

describe("MCP server", () => {
  it("lists the five tools with JSON schemas and instructions", async () => {
    const { client, close } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "jev_classify",
      "jev_check",
      "jev_score",
      "jev_rank",
      "jev_ask",
    ]);
    const check = tools.find((t) => t.name === "jev_check");
    expect(check).toBeDefined();
    const schema = check?.inputSchema as { type?: string; required?: string[] } | undefined;
    expect(schema?.type).toBe("object");
    expect(schema?.required).toEqual(expect.arrayContaining(["state", "checks"]));
    expect(check?.annotations).toMatchObject({ readOnlyHint: true });
    expect(client.getInstructions()).toContain("raw evidence");
    await close();
  });

  it("round-trips a tool call through a fake API", async () => {
    const { client: jev } = clientWith(() => noul(0.9));
    const { client, close } = await connect(() => jev);
    const result = await client.callTool({
      name: "jev_check",
      arguments: { state: "12 passed", checks: { green: "All passed?" } },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    expect(JSON.parse(text).results[0]).toMatchObject({ id: "green", verdict: "yes" });
    await close();
  });

  it("reports a missing API key as a tool error, not a crash", async () => {
    const { client, close } = await connect(() => JevClient.fromEnv({}));
    const result = await client.callTool({
      name: "jev_check",
      arguments: { state: "x", checks: { a: "q" } },
    });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
      "TYPESAFE_API_KEY is not set",
    );
    await close();
  });

  it("rejects invalid arguments with a readable message", async () => {
    const { client: jev } = clientWith(() => noul(0.9));
    const { client, close } = await connect(() => jev);
    const result = await client.callTool({
      name: "jev_classify",
      arguments: { items: [], classes: { a: null, b: null } },
    });
    expect(result.isError).toBe(true);
    await close();
  });
});
