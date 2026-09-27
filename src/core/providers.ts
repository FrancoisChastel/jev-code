/**
 * Hosts that serve Jev behind the System One API (`POST /v1/systemone`).
 *
 * Every host speaks the same request and response shapes; only the URL, the key, and the
 * default model id differ. The list order is the precedence when several keys are set:
 * TypeSafe first, because it is the direct hop.
 */
export type ProviderName = "typesafe" | "openrouter" | "vercel";

export interface Provider {
  readonly name: ProviderName;
  readonly label: string;
  /** Environment variable that conventionally holds this host's key. */
  readonly keyEnv: string;
  /** Prefix of the keys this host issues; it routes a key whichever variable holds it. */
  readonly keyPrefix: string;
  readonly baseUrl: string;
  /** Hostname of `baseUrl`, for matching a custom base URL back to a provider. */
  readonly host: string;
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

/** Every supported host, in precedence order. Frozen: this table decides where keys go. */
export const PROVIDERS: readonly Provider[] = Object.freeze([TYPESAFE, OPENROUTER, VERCEL]);

export const PROVIDER_NAMES: readonly ProviderName[] = PROVIDERS.map((provider) => provider.name);

/** The host used when nothing else decides: TypeSafe direct. */
export const DEFAULT_PROVIDER: Provider = TYPESAFE;

export function providerByName(name: string): Provider | undefined {
  const wanted = name.trim().toLowerCase();
  return PROVIDERS.find((provider) => provider.name === wanted);
}

/** The host that issued a key, judged by its prefix, or undefined when the prefix is unknown. */
export function providerForKey(key: string): Provider | undefined {
  return PROVIDERS.find((provider) => key.startsWith(provider.keyPrefix));
}

/** The host a base URL points at, or undefined for proxies and malformed values. */
export function providerForUrl(url: string): Provider | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  return PROVIDERS.find((provider) => provider.host === host);
}
