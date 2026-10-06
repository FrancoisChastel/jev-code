/**
 * Public API of @french-castle/jev-code.
 *
 * - `JevClient` talks to supported built-in hosts or an explicitly configured custom System One host.
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
  isCustomProvider,
  type JevConfig,
  maskSecret,
  type ProviderSelection,
  providerNameFromSetting,
  resolveConfig,
  selectProvider,
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
export {
  type BuiltInProviderName,
  DEFAULT_PROVIDER,
  keyPrefixes,
  PROVIDER_NAMES,
  PROVIDERS,
  type Provider,
  type ProviderName,
  providerByName,
  providerForKey,
  providerForUrl,
  type SelectedProvider,
} from "./core/providers.js";
export type * from "./core/types.js";
export {
  OPENAI_DECISIONS_WIRE,
  SYSTEM_ONE_WIRE,
  WIRES,
  type Wire,
  type WireName,
} from "./core/wires.js";
export {
  createJevMcpServer,
  MCP_SERVER_NAME,
  type McpServerOptions,
  serveStdio,
} from "./mcp/server.js";
export * from "./setup/index.js";
export * from "./tools/index.js";
export { PACKAGE_NAME, VERSION } from "./version.js";
