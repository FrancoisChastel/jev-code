/**
 * Public API of @francoischastel/jev-code.
 *
 * - `JevClient` talks to the TypeSafe System One API.
 * - `TOOLS` are the five judgment tools shared by every harness adapter.
 * - `createJevMcpServer` exposes them over MCP.
 * - `runSetup` installs the skill and the tool into local coding agents.
 */
export {
  type FetchLike,
  JevClient,
  type JevClientOptions,
  type RequestOptions,
} from "./core/client.js";
export {
  CONSOLE_KEYS_URL,
  type ConfigSummary,
  DEFAULTS,
  describeConfig,
  ENV,
  type JevConfig,
  maskSecret,
  resolveConfig,
} from "./core/config.js";
export {
  errorMessage,
  JevApiError,
  JevConfigError,
  JevConnectionError,
  JevError,
  JevTimeoutError,
  JevValidationError,
} from "./core/errors.js";
export { LIMITS } from "./core/limits.js";
export type * from "./core/types.js";
export {
  createJevMcpServer,
  MCP_SERVER_NAME,
  type McpServerOptions,
  serveStdio,
} from "./mcp/server.js";
export * from "./setup/index.js";
export * from "./tools/index.js";
export { PACKAGE_NAME, VERSION } from "./version.js";
