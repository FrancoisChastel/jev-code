/**
 * Hosts that serve Jev behind the System One API (`POST /v1/systemone`).
 *
 * Every host speaks the same request and response shapes; only the URL, the key, and the
 * default model id differ. The list order is the precedence when several keys are set:
 * TypeSafe first, because it is the direct hop.
 */
import type { WireName } from "./wires.js";

export type ProviderName = "typesafe" | "openrouter" | "vercel" | "openai" | "ollama";

export interface Provider {
  readonly name: ProviderName;
  readonly label: string;
  /** Environment variable that conventionally holds this host's key. */
  readonly keyEnv: string;
  /** Prefix of the keys this host issues; it routes a key whichever variable holds it. */
  readonly keyPrefix?: string;
  /** The host works without a key (a local server); a key is sent only when one is set. */
  readonly keyless?: true;
  /** Environment variable naming the server, e.g. OLLAMA_HOST; TYPESAFE_BASE_URL still wins. */
  readonly hostEnv?: string;
  /** Other prefixes the same host issues. */
  readonly altPrefixes?: readonly string[];
  /** Request shape the host speaks; System One unless said otherwise. */
  readonly wire?: WireName;
  /**
   * Never picked up from an ambient key: the host is used only when JEV_CODE_PROVIDER names
   * it. For keys that many unrelated tools set, so agent evidence never changes destination
   * without a decision.
   */
  readonly explicitOnly?: true;
  readonly baseUrl: string;
  /** Hostname of `baseUrl`, for matching a custom base URL back to a provider; absent for local servers. */
  readonly host?: string;
  /** Default model id on this host. */
  readonly model: string;
  /** Where to create a key. */
  readonly keysUrl: string;
  /** Response header carrying the request id, when the host sends one. */
  readonly requestIdHeader?: string;
  /** Extra request headers, such as OpenRouter's optional app attribution. */
  readonly headers?: Readonly<Record<string, string>>;
}

const TYPESAFE: Provider = Object.freeze({
  name: "typesafe",
  label: "TypeSafe",
  keyEnv: "TYPESAFE_API_KEY",
  keyPrefix: "ts_",
  baseUrl: "https://api.typesafe.ai",
  host: "api.typesafe.ai",
  model: "jev-latest",
  keysUrl: "https://console.typesafe.ai/keys",
  requestIdHeader: "x-typesafe-request-id",
});

const OPENROUTER: Provider = Object.freeze({
  name: "openrouter",
  label: "OpenRouter",
  keyEnv: "OPENROUTER_API_KEY",
  keyPrefix: "sk-or-",
  baseUrl: "https://openrouter.ai/api",
  host: "openrouter.ai",
  model: "jev-latest",
  keysUrl: "https://openrouter.ai/settings/keys",
  headers: Object.freeze({
    "HTTP-Referer": "https://github.com/FrancoisChastel/jev-code",
    "X-Title": "jev-code",
  }),
});

const VERCEL: Provider = Object.freeze({
  name: "vercel",
  label: "Vercel AI Gateway",
  keyEnv: "AI_GATEWAY_API_KEY",
  keyPrefix: "vck_",
  baseUrl: "https://ai-gateway.vercel.sh/typesafe",
  host: "ai-gateway.vercel.sh",
  model: "typesafe-ai/jev",
  keysUrl: "https://vercel.com/docs/ai-gateway/authentication-and-byok/api-keys",
  requestIdHeader: "x-vercel-id",
});

/**
 * OpenAI's Decisions API, in limited preview: the same three question types behind a different
 * request shape (see wires.ts). Opt-in only, because OPENAI_API_KEY is set in many shells for
 * other reasons and most accounts do not have Decisions access yet.
 */
const OPENAI: Provider = Object.freeze({
  name: "openai",
  label: "OpenAI Decisions API",
  keyEnv: "OPENAI_API_KEY",
  keyPrefix: "sk-proj-",
  altPrefixes: Object.freeze(["sk-svcacct-"]),
  baseUrl: "https://api.openai.com",
  host: "api.openai.com",
  model: "gpt-6-luna",
  keysUrl: "https://platform.openai.com/api-keys",
  requestIdHeader: "x-request-id",
  wire: "openai-decisions",
  explicitOnly: true,
});

/**
 * Ollama's decision capability (Ollama 0.35+): local decision models (nimble, tev1, clef,
 * clef-flash) behind the very same System One API, no key needed. Opt-in because there is no
 * key to detect; OLLAMA_HOST names a server other than localhost:11434.
 */
const OLLAMA: Provider = Object.freeze({
  name: "ollama",
  label: "Ollama",
  keyEnv: "OLLAMA_API_KEY",
  keyless: true,
  hostEnv: "OLLAMA_HOST",
  baseUrl: "http://localhost:11434",
  model: "nimble",
  keysUrl: "https://docs.ollama.com/capabilities/decision",
  explicitOnly: true,
});

/** Every supported host, in precedence order. Frozen: this table decides where keys go. */
export const PROVIDERS: readonly Provider[] = Object.freeze([
  TYPESAFE,
  OPENROUTER,
  VERCEL,
  OPENAI,
  OLLAMA,
]);

export const PROVIDER_NAMES: readonly ProviderName[] = PROVIDERS.map((provider) => provider.name);

/** The host used when nothing else decides: TypeSafe direct. */
export const DEFAULT_PROVIDER: Provider = TYPESAFE;

export function providerByName(name: string): Provider | undefined {
  const wanted = name.trim().toLowerCase();
  return PROVIDERS.find((provider) => provider.name === wanted);
}

/** Every prefix a host issues keys under; empty when its keys have no recognisable prefix. */
export function keyPrefixes(provider: Provider): readonly string[] {
  return [...(provider.keyPrefix ? [provider.keyPrefix] : []), ...(provider.altPrefixes ?? [])];
}

/** The host that issued a key, judged by its prefix, or undefined when the prefix is unknown. */
export function providerForKey(key: string): Provider | undefined {
  return PROVIDERS.find((provider) => keyPrefixes(provider).some((p) => key.startsWith(p)));
}

/** The host a base URL points at, or undefined for proxies and malformed values. */
export function providerForUrl(url: string): Provider | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return PROVIDERS.find((provider) => provider.host !== undefined && provider.host === host);
}
