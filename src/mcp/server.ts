import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JevClient } from "../core/client.js";
import { describeConfig, describeProviderInUse } from "../core/config.js";
import { errorMessage } from "../core/errors.js";
import { TOOLS, USAGE_GUIDANCE } from "../tools/index.js";
import { PACKAGE_NAME, VERSION } from "../version.js";

export interface McpServerOptions {
  /** Lazily builds the API client so a missing key surfaces as a tool error, not a crash. */
  clientFactory?: () => JevClient;
  version?: string;
  /** Where the default client factory reports the host in use; stderr, which harnesses log. */
  log?: (line: string) => void;
}

export const MCP_SERVER_NAME = "jev-code";

/** The default factory names the host once, so harness logs show where payloads go. */
function clientFromEnv(log: (line: string) => void): JevClient {
  const using = describeProviderInUse(describeConfig(process.env));
  if (using) log(`${MCP_SERVER_NAME}: ${using}`);
  return JevClient.fromEnv(process.env, { userAgent: `${PACKAGE_NAME}/${VERSION} mcp` });
}

/** Create the MCP server with every jev_* tool registered. */
export function createJevMcpServer(options: McpServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: options.version ?? VERSION },
    { instructions: USAGE_GUIDANCE.join("\n") },
  );
  let client: JevClient | undefined;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const getClient = (): JevClient => {
    client ??= (options.clientFactory ?? (() => clientFromEnv(log)))();
    return client;
  };

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema.shape,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (args, extra) => {
        try {
          const result = await tool.run(getClient(), args, { signal: extra.signal });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: `${tool.name} failed: ${errorMessage(error)}` }],
          };
        }
      },
    );
  }
  return server;
}

/** Serve over stdio until the client closes the pipe. */
export async function serveStdio(options: McpServerOptions = {}): Promise<void> {
  const server = createJevMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    server.server.onclose = () => resolve();
  });
}
