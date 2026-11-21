/**
 * Hosts that answer typed decision questions: Jev behind the System One API
 * (`POST /v1/systemone`) and the decision APIs of other companies.
 *
 * Every host answers the same three question types; the URL, the key and how it is sent, the
 * request shape (see wires.ts), and the default model id differ. The list order is the
 * precedence when several keys are set: TypeSafe first, because it is the direct hop. Hosts
 * that run another company's model are opt-in (`explicitOnly`): their keys are set in many
 * shells for other reasons, and sending agent evidence to another company is a decision, not a
 * side effect of an exported key.
 */

import { trimTrailing } from "./text.js";
import type { WireName } from "./wires.js";

export type ProviderName =
  | "typesafe"
  | "openrouter"
  | "vercel"
  | "openai"
  | "azure"
  | "foundry"
  | "gemini"
  | "perplexity"
  | "cloudflare"
  | "ollama";

/**
 * A host that lives in your own cloud account. Its address comes from `env`, which is required,
 * and `base` turns that value into the base URL, or returns undefined when it is malformed.
 */
export interface AccountEndpoint {
  readonly env: string;
  /** What a value looks like, for messages. */
  readonly example: string;
  readonly base: (value: string) => string | undefined;
  /**
   * Domains the resulting host must sit under, so the key only ever reaches the cloud it
   * belongs to. A gateway in front of the resource goes through TYPESAFE_BASE_URL instead.
   */
  readonly domains?: readonly string[];
  /** The domains as messages name them. */
  readonly domainsLabel?: string;
}

/** Azure's public, US Government, and China clouds. */
const AZURE_DOMAINS: readonly string[] = Object.freeze(["azure.com", "azure.us", "azure.cn"]);

/**
 * Where Azure AI resources live, in each cloud. Narrower than the clouds themselves: anyone can
 * name a VM `<name>.<region>.cloudapp.azure.com`, so only these count as a resource, receive an
 * Azure key, and are told apart from a gateway of your own that happens to run on Azure.
 */
const AZURE_RESOURCE_DOMAINS: readonly string[] = Object.freeze(
  AZURE_DOMAINS.flatMap((cloud) =>
    ["openai", "cognitiveservices", "services.ai"].map((service) => `${service}.${cloud}`),
  ),
);
const AZURE_RESOURCE_LABEL =
  "openai.azure.com, cognitiveservices.azure.com, or services.ai.azure.com (or the same under azure.us or azure.cn)";

export interface Provider {
  readonly name: ProviderName;
  readonly label: string;
  /** Environment variable that conventionally holds this host's key. */
  readonly keyEnv: string;
  /**
   * Prefix the host's keys usually carry. A hint only: it suggests a variable when a key is
   * pasted and flags a key that looks misplaced. It never decides where a key is sent, because
   * key shapes change (TypeSafe issues `ts_` and `apikey_` keys).
   */
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
  /** Where requests go; for an account host, only an illustration of the shape. */
  readonly baseUrl: string;
  /** Hostname of `baseUrl`, for matching a custom base URL back to a provider; absent for local servers. */
  readonly host?: string;
  /** A per-account address, required: Azure resources, Cloudflare accounts. */
  readonly endpoint?: AccountEndpoint;
  /**
   * Domains whose every host the vendor runs, so any host under them is reached over https
   * only: plain http is for a gateway of your own, never for a vendor's front end.
   */
  readonly httpsDomains?: readonly string[];
  /** Path appended to the base URL when it is not the wire's own; `{model}` stands for the model id. */
  readonly path?: string;
  /** Header that carries the key as is; absent means `Authorization: Bearer <key>`. */
  readonly keyHeader?: string;
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
  altPrefixes: Object.freeze(["apikey_"]),
  baseUrl: "https://api.typesafe.ai",
  host: "api.typesafe.ai",
  httpsDomains: Object.freeze(["typesafe.ai"]),
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
  httpsDomains: Object.freeze(["openrouter.ai"]),
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
  httpsDomains: Object.freeze(["vercel.sh"]),
  model: "typesafe-ai/jev",
  keysUrl: "https://vercel.com/docs/ai-gateway/authentication-and-byok/api-keys",
  requestIdHeader: "x-vercel-id",
});

/**
 * OpenAI's Decisions API, in public beta for every developer since 2026-10-06: the same three
 * question types behind a different request shape (see wires.ts). Opt-in only, because
 * OPENAI_API_KEY is set in many shells for other reasons, and sending agent evidence to another
 * company is a decision, not a side effect of an exported key.
 */
const OPENAI: Provider = Object.freeze({
  name: "openai",
  label: "OpenAI Decisions API",
  keyEnv: "OPENAI_API_KEY",
  keyPrefix: "sk-proj-",
  altPrefixes: Object.freeze(["sk-svcacct-"]),
  baseUrl: "https://api.openai.com",
  host: "api.openai.com",
  httpsDomains: Object.freeze(["openai.com"]),
  model: "gpt-6-luna",
  keysUrl: "https://platform.openai.com/api-keys",
  requestIdHeader: "x-request-id",
  wire: "openai-decisions",
  explicitOnly: true,
});

/**
 * OpenAI's Decisions API on an Azure OpenAI resource: the same request shape at
 * `https://<resource>.openai.azure.com/openai/v1/decisions`, the key in an `api-key` header, and
 * the model field naming your deployment (gpt-6-luna is the only supported model).
 * https://learn.microsoft.com/azure/foundry/openai/how-to/decisions
 */
const AZURE: Provider = Object.freeze({
  name: "azure",
  label: "Azure OpenAI Decisions API",
  keyEnv: "AZURE_OPENAI_API_KEY",
  baseUrl: "https://<resource>.openai.azure.com/openai",
  endpoint: Object.freeze({
    env: "AZURE_OPENAI_ENDPOINT",
    example: "https://<resource>.openai.azure.com",
    // Accept the resource endpoint as the portal shows it, or as the SDK examples write it.
    base: (value: string) => `${stripSuffixes(value, ["/v1", "/openai"])}/openai`,
    domains: AZURE_RESOURCE_DOMAINS,
    domainsLabel: AZURE_RESOURCE_LABEL,
  }),
  httpsDomains: AZURE_DOMAINS,
  keyHeader: "api-key",
  model: "gpt-6-luna",
  keysUrl: "https://learn.microsoft.com/azure/foundry/openai/how-to/decisions",
  requestIdHeader: "apim-request-id",
  wire: "openai-decisions",
  explicitOnly: true,
});

/**
 * Microsoft-Decision-1.1 on a Microsoft Foundry resource: the System One request shape at
 * `<resource endpoint>/providers/microsoft/v1/systemone`, the key in an `api-key` header, and
 * the model field naming your deployment.
 * https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision
 */
const FOUNDRY: Provider = Object.freeze({
  name: "foundry",
  label: "Microsoft Foundry",
  keyEnv: "AZURE_API_KEY",
  baseUrl: "https://<resource>.services.ai.azure.com",
  endpoint: Object.freeze({
    env: "AZURE_ENDPOINT",
    example: "https://<resource>.services.ai.azure.com",
    base: (value: string) =>
      stripSuffixes(value, ["/systemone", "/v1", "/microsoft", "/providers"]),
    domains: AZURE_RESOURCE_DOMAINS,
    domainsLabel: AZURE_RESOURCE_LABEL,
  }),
  httpsDomains: AZURE_DOMAINS,
  path: "/providers/microsoft/v1/systemone",
  keyHeader: "api-key",
  model: "Microsoft-Decision-1.1",
  keysUrl:
    "https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision",
  requestIdHeader: "apim-request-id",
  explicitOnly: true,
});

/** Google's Gemini Decisions API (gemini-decision-1, Gemini Developer API v1beta). */
const GEMINI: Provider = Object.freeze({
  name: "gemini",
  label: "Gemini Decisions API",
  keyEnv: "GEMINI_API_KEY",
  keyPrefix: "AIza",
  baseUrl: "https://generativelanguage.googleapis.com",
  host: "generativelanguage.googleapis.com",
  httpsDomains: Object.freeze(["googleapis.com"]),
  keyHeader: "x-goog-api-key",
  model: "gemini-decision-1",
  keysUrl: "https://aistudio.google.com/apikey",
  wire: "gemini-decisions",
  explicitOnly: true,
});

/** Perplexity's Decisions API: the System One request shape at `/v1/decisions`. */
const PERPLEXITY: Provider = Object.freeze({
  name: "perplexity",
  label: "Perplexity Decisions API",
  keyEnv: "PERPLEXITY_API_KEY",
  keyPrefix: "pplx-",
  baseUrl: "https://api.perplexity.ai",
  host: "api.perplexity.ai",
  httpsDomains: Object.freeze(["perplexity.ai"]),
  path: "/v1/decisions",
  model: "pplx-decider-latest",
  keysUrl: "https://docs.perplexity.ai/docs/decisions/quickstart",
  requestIdHeader: "x-request-id",
  explicitOnly: true,
});

/**
 * Cloudflare's Clef models on Workers AI: the System One body at
 * `/client/v4/accounts/<account id>/ai/run/@cf/cloudflare/<model>`, wrapped in Cloudflare's
 * response envelope (see wires.ts). The account id is the 32-character hex id on the dashboard.
 */
const CLOUDFLARE: Provider = Object.freeze({
  name: "cloudflare",
  label: "Cloudflare Workers AI",
  keyEnv: "CLOUDFLARE_API_TOKEN",
  baseUrl: "https://api.cloudflare.com/client/v4/accounts/<account id>/ai/run/@cf/cloudflare",
  host: "api.cloudflare.com",
  httpsDomains: Object.freeze(["cloudflare.com"]),
  endpoint: Object.freeze({
    env: "CLOUDFLARE_ACCOUNT_ID",
    example: "your 32-character account id",
    base: (value: string) =>
      /^[0-9a-f]{32}$/i.test(value)
        ? `https://api.cloudflare.com/client/v4/accounts/${value.toLowerCase()}/ai/run/@cf/cloudflare`
        : undefined,
  }),
  path: "/{model}",
  model: "clef-flash",
  keysUrl: "https://developers.cloudflare.com/workers-ai/models/clef-flash/",
  requestIdHeader: "cf-ray",
  wire: "workers-ai",
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
  AZURE,
  FOUNDRY,
  GEMINI,
  PERPLEXITY,
  CLOUDFLARE,
  OLLAMA,
]);

export const PROVIDER_NAMES: readonly ProviderName[] = PROVIDERS.map((provider) => provider.name);

/** The host used when nothing else decides: TypeSafe direct. */
export const DEFAULT_PROVIDER: Provider = TYPESAFE;

export function providerByName(name: string): Provider | undefined {
  const wanted = name.trim().toLowerCase();
  return PROVIDERS.find((provider) => provider.name === wanted);
}

/** The variables a host needs, as help and doctor list them. */
export function providerVariables(provider: Provider): string {
  if (provider.keyless) return `${provider.hostEnv ?? ""} (optional)`;
  return provider.endpoint ? `${provider.keyEnv} + ${provider.endpoint.env}` : provider.keyEnv;
}

/** Every prefix a host issues keys under; empty when its keys have no recognisable prefix. */
export function keyPrefixes(provider: Provider): readonly string[] {
  return [...(provider.keyPrefix ? [provider.keyPrefix] : []), ...(provider.altPrefixes ?? [])];
}

/** The host a key looks like it came from, by prefix; a hint, never a routing decision. */
export function providerForKey(key: string): Provider | undefined {
  return PROVIDERS.find((provider) => keyPrefixes(provider).some((p) => key.startsWith(p)));
}

/** Remove trailing slashes, then each suffix in turn when the value ends with it. */
function stripSuffixes(value: string, suffixes: readonly string[]): string {
  let out = trimTrailing(value.trim(), "/");
  for (const suffix of suffixes) {
    if (out.toLowerCase().endsWith(suffix)) out = trimTrailing(out.slice(0, -suffix.length), "/");
  }
  return out;
}

/** True when `hostname` is `domain` or sits under it. */
export function isUnderDomain(hostname: string, domain: string): boolean {
  const host = trimTrailing(hostname.toLowerCase(), ".");
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Where a URL's host must be reached over https: the known provider it names, or the domain it
 * sits under (every Azure resource lives under an Azure cloud domain). Undefined for anything else.
 */
export function httpsOnlyHost(url: string): { provider: Provider; domain?: string } | undefined {
  const exact = providerForUrl(url);
  if (exact) return { provider: exact };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  for (const provider of PROVIDERS) {
    const domain = provider.httpsDomains?.find((d) => isUnderDomain(host, d));
    if (domain) return { provider, domain };
  }
  return undefined;
}

/**
 * Every host a base URL may belong to: the one whose exact host it names, or the account hosts
 * whose resource domains it sits under (an Azure resource can serve Azure OpenAI and Foundry
 * alike). Empty for a proxy or a malformed value.
 */
export function providersForUrl(url: string): Provider[] {
  const exact = providerForUrl(url);
  if (exact) return [exact];
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return [];
  }
  return PROVIDERS.filter((provider) =>
    provider.endpoint?.domains?.some((domain) => isUnderDomain(host, domain)),
  );
}

/** The host a base URL points at by its exact hostname, or undefined for anything else. */
export function providerForUrl(url: string): Provider | undefined {
  let host: string;
  try {
    // "api.openai.com." names the same host; a trailing dot must not make it a stranger.
    host = trimTrailing(new URL(url).hostname.toLowerCase(), ".");
  } catch {
    return undefined;
  }
  return PROVIDERS.find((provider) => provider.host !== undefined && provider.host === host);
}
