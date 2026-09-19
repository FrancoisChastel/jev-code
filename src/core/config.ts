import { JevConfigError } from "./errors.js";

/** Environment variable names. The `TYPESAFE_*` names match the official SDKs. */
export const ENV = {
  apiKey: "TYPESAFE_API_KEY",
  baseUrl: "TYPESAFE_BASE_URL",
  model: "TYPESAFE_DEFAULT_MODEL",
  timeoutMs: "JEV_CODE_TIMEOUT_MS",
  maxRetries: "JEV_CODE_MAX_RETRIES",
} as const;

export const DEFAULTS = {
  baseUrl: "https://api.typesafe.ai",
  model: "jev-latest",
  timeoutMs: 30_000,
  maxRetries: 2,
} as const;

export const CONSOLE_KEYS_URL = "https://console.typesafe.ai/keys";

export interface JevConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

type Env = Record<string, string | undefined>;

function readPositiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new JevConfigError(`${name} must be a non-negative integer, got "${raw}".`);
  }
  return value;
}

/** Resolve the client configuration from the environment. Throws when the API key is missing. */
export function resolveConfig(env: Env = process.env): JevConfig {
  const apiKey = env[ENV.apiKey]?.trim();
  if (!apiKey) {
    throw new JevConfigError(
      `${ENV.apiKey} is not set. Create a key at ${CONSOLE_KEYS_URL} and export it, ` +
        `for example: export ${ENV.apiKey}=ts_...`,
    );
  }
  return {
    apiKey,
    baseUrl: (env[ENV.baseUrl]?.trim() || DEFAULTS.baseUrl).replace(/\/+$/, ""),
    model: env[ENV.model]?.trim() || DEFAULTS.model,
    timeoutMs: readPositiveInt(env, ENV.timeoutMs, DEFAULTS.timeoutMs),
    maxRetries: readPositiveInt(env, ENV.maxRetries, DEFAULTS.maxRetries),
  };
}

/** A secret-free view of the configuration, for `doctor` and logs. */
export interface ConfigSummary {
  hasApiKey: boolean;
  apiKeyHint: string | null;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export function describeConfig(env: Env = process.env): ConfigSummary {
  const apiKey = env[ENV.apiKey]?.trim() ?? "";
  return {
    hasApiKey: apiKey.length > 0,
    apiKeyHint: apiKey.length > 0 ? maskSecret(apiKey) : null,
    baseUrl: (env[ENV.baseUrl]?.trim() || DEFAULTS.baseUrl).replace(/\/+$/, ""),
    model: env[ENV.model]?.trim() || DEFAULTS.model,
    timeoutMs: readPositiveInt(env, ENV.timeoutMs, DEFAULTS.timeoutMs),
    maxRetries: readPositiveInt(env, ENV.maxRetries, DEFAULTS.maxRetries),
  };
}

/** Keep a short prefix and suffix so a user can recognise which key is loaded. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}
