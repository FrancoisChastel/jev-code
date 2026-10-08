import { errorMessage, JevConfigError } from "./errors.js";
import {
  DEFAULT_PROVIDER,
  keyPrefixes,
  PROVIDER_NAMES,
  PROVIDERS,
  type Provider,
  type ProviderName,
  providerByName,
  providerForKey,
  providerForUrl,
} from "./providers.js";
import { SYSTEM_ONE_WIRE, type WireName } from "./wires.js";

/**
 * Environment variable names. The `TYPESAFE_*` names match the official SDKs; each host's
 * key lives in its own conventional variable (see providers.ts).
 */
export const ENV = {
  apiKey: "TYPESAFE_API_KEY",
  baseUrl: "TYPESAFE_BASE_URL",
  model: "TYPESAFE_DEFAULT_MODEL",
  provider: "JEV_CODE_PROVIDER",
  timeoutMs: "JEV_CODE_TIMEOUT_MS",
  maxRetries: "JEV_CODE_MAX_RETRIES",
} as const;

export const DEFAULTS = {
  baseUrl: DEFAULT_PROVIDER.baseUrl,
  model: DEFAULT_PROVIDER.model,
  timeoutMs: 30_000,
  maxRetries: 2,
} as const;

export const CONSOLE_KEYS_URL = DEFAULT_PROVIDER.keysUrl;

export interface JevConfig {
  provider: ProviderName;
  /** Request shape the host speaks. */
  wire: WireName;
  /** The variable the key was read from. */
  keyEnv: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  headers: Record<string, string>;
  requestIdHeader?: string;
}

type Env = Record<string, string | undefined>;

interface KeyCandidate {
  keyEnv: string;
  key: string;
  /** The host of the variable the key sits in. The variable decides, never the key's shape. */
  provider: Provider;
}

export interface ProviderSelection {
  provider: Provider;
  keyEnv: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Non-fatal observations worth showing, e.g. several keys set. */
  notes: readonly string[];
}

function readPositiveInt(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new JevConfigError(`${name} must be a non-negative integer, got "${raw}".`);
  }
  return value;
}

/**
 * TYPESAFE_BASE_URL, checked before anything is sent. It names a proxy or a System One gateway
 * of your own, and the client appends the endpoint path to it, so it must be an absolute
 * http(s) URL with no credentials, query, or fragment, stopping before `/v1/systemone`. The
 * messages never echo the value: it may embed a secret.
 */
function readBaseUrl(env: Env): string | undefined {
  const raw = env[ENV.baseUrl]?.trim();
  if (!raw) return undefined;
  const url = parseUrl(raw);
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new JevConfigError(`${ENV.baseUrl} must be an absolute http(s) URL.`);
  }
  if (url.username || url.password) {
    throw new JevConfigError(
      `${ENV.baseUrl} must not embed credentials; the key goes in its own variable.`,
    );
  }
  if (/[?#]/.test(raw)) {
    throw new JevConfigError(
      `${ENV.baseUrl} must not carry a query or fragment; ${SYSTEM_ONE_WIRE.path} is appended to it.`,
    );
  }
  const base = raw.replace(/\/+$/, "");
  if (base.endsWith(SYSTEM_ONE_WIRE.path)) {
    throw new JevConfigError(
      `${ENV.baseUrl} must stop before ${SYSTEM_ONE_WIRE.path}; the client appends it.`,
    );
  }
  return base;
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** The provider JEV_CODE_PROVIDER names, when it names a known one. */
function explicitProvider(env: Env): Provider | undefined {
  const name = env[ENV.provider]?.trim();
  return name ? providerByName(name) : undefined;
}

/** The variable the TypeSafe SDK reads. It follows TYPESAFE_BASE_URL and JEV_CODE_PROVIDER. */
const GENERIC_KEY = ENV.apiKey;

/** Hosts that TYPESAFE_API_KEY may follow: the ones that speak the TypeSafe SDK's protocol. */
function acceptsGenericKey(provider: Provider): boolean {
  return (provider.wire ?? "systemone") === "systemone" && !provider.keyless;
}

/**
 * Every key variable that is set, in precedence order. The variable decides the host: key
 * shapes change (TypeSafe issues `ts_` and `apikey_` keys, for one), so a key's prefix is never
 * trusted to reroute it. Keys of opt-in hosts count only when JEV_CODE_PROVIDER names the host.
 */
function findKeys(env: Env): KeyCandidate[] {
  const explicit = explicitProvider(env);
  const out: KeyCandidate[] = [];
  for (const provider of PROVIDERS) {
    const key = env[provider.keyEnv]?.trim();
    if (!key) continue;
    if (provider.explicitOnly && explicit?.name !== provider.name) continue;
    out.push({ keyEnv: provider.keyEnv, key, provider });
  }
  return out;
}

/** Opt-in hosts whose own variable is set while nobody asked for them, so the user can be told. */
function heldBackKeys(env: Env): KeyCandidate[] {
  const explicit = explicitProvider(env);
  const out: KeyCandidate[] = [];
  for (const provider of PROVIDERS) {
    const key = env[provider.keyEnv]?.trim();
    if (!key || !provider.explicitOnly || provider.keyless || explicit?.name === provider.name)
      continue;
    out.push({ keyEnv: provider.keyEnv, key, provider });
  }
  return out;
}

function heldBackNote(candidate: KeyCandidate): string {
  const { keyEnv, provider } = candidate;
  return `${keyEnv} is set, but ${provider.label} is used only when ${ENV.provider}=${provider.name} is set.`;
}

/**
 * Ollama accepts OLLAMA_HOST as a URL, a host:port, or a bare host; make it a base URL.
 */
export function serverUrlFromHost(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (/^[a-z]+:\/\//i.test(trimmed)) return trimmed;
  const withPort = /:\d+$/.test(trimmed) ? trimmed : `${trimmed}:11434`;
  return `http://${withPort}`;
}

/** A keyless host named by JEV_CODE_PROVIDER needs no key; it still honours the overrides. */
function selectKeyless(
  env: Env,
  provider: Provider,
  explicitUrl: string | undefined,
): ProviderSelection {
  const hostValue = provider.hostEnv ? env[provider.hostEnv]?.trim() : undefined;
  const baseUrl = explicitUrl ?? (hostValue ? serverUrlFromHost(hostValue) : provider.baseUrl);
  const key = env[provider.keyEnv]?.trim() ?? "";
  return {
    provider,
    keyEnv: key ? provider.keyEnv : "",
    apiKey: key,
    baseUrl,
    model: env[ENV.model]?.trim() || provider.model,
    notes: hostValue && !explicitUrl ? [`Requests go to ${baseUrl} (${provider.hostEnv}).`] : [],
  };
}

function missingKeyError(env: Env): JevConfigError {
  const options = PROVIDERS.filter((p) => !p.explicitOnly).map(
    (p) => `${p.keyEnv} (${p.label}, ${p.keysUrl})`,
  );
  const last = options.pop();
  const held = heldBackKeys(env);
  const optIn = PROVIDERS.filter(
    (p) => p.explicitOnly && !held.some((c) => c.provider.name === p.name),
  ).map((p) =>
    p.keyless
      ? ` ${p.label}: set ${ENV.provider}=${p.name} (no key; ${p.hostEnv} names a server other than ${p.baseUrl}).`
      : ` ${p.label}: export ${p.keyEnv} and set ${ENV.provider}=${p.name}.`,
  );
  const hints = [...held.map((c) => ` ${heldBackNote(c)}`), ...optIn];
  return new JevConfigError(
    `No API key found. Export one of ${options.join(", ")}, or ${last}.${hints.join("")}`,
  );
}

/** The setting that redirected the key away from its variable's own host, and why. */
interface Override {
  variable: string;
  reason: string;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** A key shaped like another host's earns a hint, never a different route. */
function looksLikeNote(
  chosen: KeyCandidate,
  provider: Provider,
  override: Override | undefined,
): string | undefined {
  const lookalike = providerForKey(chosen.key);
  if (!lookalike || lookalike.name === provider.name) return undefined;
  const prefix = keyPrefixes(lookalike).find((p) => chosen.key.startsWith(p)) ?? "";
  const fix =
    lookalike.keyEnv === chosen.keyEnv && override
      ? `unset ${override.variable}`
      : lookalike.explicitOnly
        ? `move it to ${lookalike.keyEnv} and set ${ENV.provider}=${lookalike.name}`
        : `move it to ${lookalike.keyEnv}`;
  return `${chosen.keyEnv} looks like ${article(lookalike.label)} ${lookalike.label} key (${prefix}…) but is sent to ${provider.label}, as set. If it belongs to ${lookalike.label}, ${fix}.`;
}

/** Observations worth showing next to a successful selection. */
function selectionNotes(
  chosen: KeyCandidate,
  candidates: readonly KeyCandidate[],
  provider: Provider,
  baseUrlOverride: string | undefined,
  override: Override | undefined,
): string[] {
  const notes: string[] = [];
  if (baseUrlOverride && !providerForUrl(baseUrlOverride)) {
    notes.push(
      `Requests go to ${baseUrlOverride} (${ENV.baseUrl}) with the ${provider.label} key.`,
    );
  }
  // A lookalike note already says where the key goes, so the SDK explanation would only nudge
  // the other way; one hint at a time.
  const lookalike = looksLikeNote(chosen, provider, override);
  if (lookalike) notes.push(lookalike);
  else if (override && chosen.keyEnv === GENERIC_KEY && provider.keyEnv !== GENERIC_KEY) {
    notes.push(
      `${GENERIC_KEY} is sent to ${provider.label} because ${override.reason}, as the TypeSafe SDK would; ${provider.keyEnv} says the same more plainly.`,
    );
  }
  const others = candidates.filter((c) => c !== chosen);
  if (others.length > 0) {
    const names = [chosen, ...others].map((c) => c.keyEnv);
    // Switching under a base URL override means changing the URL, so no one-liner is offered.
    const switches =
      override?.variable === ENV.baseUrl
        ? []
        : [...new Set(others.map((c) => c.provider.name))]
            .filter((name) => name !== provider.name)
            .map((name) => `${ENV.provider}=${name}`);
    const hint = switches.length ? ` Set ${switches.join(" or ")} to switch.` : "";
    notes.push(
      `${names.join(" and ")} are ${names.length > 2 ? "all" : "both"} set; using ${provider.label} (${chosen.keyEnv}).${hint}`,
    );
  }
  return notes;
}

/** The host was named, its own variable is empty, and no generic key may follow. */
function noKeyForTarget(
  env: Env,
  target: Provider,
  candidates: readonly KeyCandidate[],
  override: Override,
): JevConfigError {
  const held = heldBackKeys(env).find((c) => c.provider.name === target.name);
  if (held) return new JevConfigError(`${override.reason}; ${heldBackNote(held)}`);
  const alsoGeneric =
    acceptsGenericKey(target) && target.keyEnv !== GENERIC_KEY
      ? ` (or ${GENERIC_KEY}, which follows ${override.variable} as the TypeSafe SDK does)`
      : "";
  const set = candidates.map((c) => c.keyEnv).join(", ");
  return new JevConfigError(
    `${override.reason}, but no key is set for ${target.label}: export ${target.keyEnv}${alsoGeneric}. Set now: ${set}; a host-specific key is never sent to another host.`,
  );
}

/**
 * Pick the host and the key from the environment.
 *
 * The variable a key sits in decides its host; a key's shape never does. `JEV_CODE_PROVIDER`,
 * or a `TYPESAFE_BASE_URL` on a known host, names the host instead: that host's own variable
 * is used, or else `TYPESAFE_API_KEY`, which follows the override the way the TypeSafe SDK
 * does. A host-specific variable is never sent anywhere else. Otherwise the first variable set
 * wins. Throws `JevConfigError` when nothing usable is set.
 */
export function selectProvider(env: Env): ProviderSelection {
  const explicitName = env[ENV.provider]?.trim();
  const explicit = explicitName ? providerByName(explicitName) : undefined;
  if (explicitName && !explicit) {
    throw new JevConfigError(
      `${ENV.provider} must be one of ${PROVIDER_NAMES.join(", ")}, got "${explicitName}".`,
    );
  }
  const baseUrlOverride = readBaseUrl(env);
  const urlProvider = baseUrlOverride ? providerForUrl(baseUrlOverride) : undefined;
  if (explicit && urlProvider && explicit.name !== urlProvider.name) {
    throw new JevConfigError(
      `${ENV.provider}=${explicit.name} but ${ENV.baseUrl} points at ${urlProvider.label} (${urlProvider.host}). Change one of them.`,
    );
  }
  // A keyless host is reached only after the check above, so a stale base URL on another known
  // host cannot carry its key or the payload there; an unrecognised URL is a proxy it asked for.
  if (explicit?.keyless) return selectKeyless(env, explicit, baseUrlOverride);

  const candidates = findKeys(env);
  const [first] = candidates;
  if (!first) throw missingKeyError(env);

  const target = explicit ?? urlProvider;
  if (!target) return finishSelection(env, first, candidates, first.provider, baseUrlOverride);

  const override: Override = explicit
    ? { variable: ENV.provider, reason: `${ENV.provider}=${explicit.name}` }
    : { variable: ENV.baseUrl, reason: `${ENV.baseUrl} points at ${target.label}` };
  const own = candidates.find((c) => c.provider.name === target.name);
  const generic = acceptsGenericKey(target)
    ? candidates.find((c) => c.keyEnv === GENERIC_KEY)
    : undefined;
  const chosen = own ?? generic;
  if (!chosen) throw noKeyForTarget(env, target, candidates, override);
  return finishSelection(env, chosen, candidates, target, baseUrlOverride, override);
}

/**
 * A base URL on an unrecognised host (a proxy) is followed by TYPESAFE_API_KEY, as the SDK
 * does. A host-specific key follows it only when `JEV_CODE_PROVIDER` states the intent, so an
 * ambient OpenRouter or Vercel key never follows a TypeSafe-named override to a stranger.
 */
function assertProxyIsIntended(
  env: Env,
  provider: Provider,
  chosen: KeyCandidate,
  baseUrlOverride: string | undefined,
): void {
  if (!baseUrlOverride || providerForUrl(baseUrlOverride)) return;
  if (chosen.keyEnv === GENERIC_KEY || env[ENV.provider]?.trim()) return;
  throw new JevConfigError(
    `${ENV.baseUrl} points at an unrecognised host (${baseUrlOverride}) while the key in use is ${chosen.keyEnv}, which belongs to ${provider.label}. A custom base URL is followed by ${GENERIC_KEY} only, unless ${ENV.provider}=${provider.name} says the proxy is meant for ${provider.label}.`,
  );
}

function finishSelection(
  env: Env,
  chosen: KeyCandidate,
  candidates: readonly KeyCandidate[],
  provider: Provider,
  baseUrlOverride: string | undefined,
  override?: Override,
): ProviderSelection {
  assertProxyIsIntended(env, provider, chosen, baseUrlOverride);
  return {
    provider,
    keyEnv: chosen.keyEnv,
    apiKey: chosen.key,
    baseUrl: baseUrlOverride ?? provider.baseUrl,
    model: env[ENV.model]?.trim() || provider.model,
    notes: selectionNotes(chosen, candidates, provider, baseUrlOverride, override),
  };
}

/** One line naming the host and key in use, for setup, doctor, and server logs. */
export function describeProviderInUse(summary: ConfigSummary): string | undefined {
  if (!summary.provider) return undefined;
  const key = summary.keyEnv ? `${summary.keyEnv} ${summary.apiKeyHint}` : "no key";
  return `Using ${summary.providerLabel} (${key}).`;
}

/** Resolve the client configuration from the environment. Throws when no key is usable. */
export function resolveConfig(env: Env = process.env): JevConfig {
  const selection = selectProvider(env);
  const { provider } = selection;
  return {
    provider: provider.name,
    wire: provider.wire ?? "systemone",
    keyEnv: selection.keyEnv,
    apiKey: selection.apiKey,
    baseUrl: selection.baseUrl,
    model: selection.model,
    timeoutMs: readPositiveInt(env, ENV.timeoutMs, DEFAULTS.timeoutMs),
    maxRetries: readPositiveInt(env, ENV.maxRetries, DEFAULTS.maxRetries),
    headers: { ...provider.headers },
    ...(provider.requestIdHeader ? { requestIdHeader: provider.requestIdHeader } : {}),
  };
}

/** A secret-free view of the configuration, for `doctor`, `setup`, and logs. */
export interface ConfigSummary {
  hasApiKey: boolean;
  apiKeyHint: string | null;
  provider?: ProviderName;
  providerLabel?: string;
  keyEnv?: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  /** Non-fatal observations worth showing, e.g. several keys set. */
  notes: readonly string[];
  /** Why the configuration cannot be used: keys that conflict, or a malformed override. */
  problem?: string;
}

/** Describe the configuration without throwing; problems are reported, not raised. */
export function describeConfig(env: Env = process.env): ConfigSummary {
  const problems: string[] = [];
  const safeInt = (name: string, fallback: number): number => {
    try {
      return readPositiveInt(env, name, fallback);
    } catch (error) {
      problems.push(errorMessage(error));
      return fallback;
    }
  };
  // A malformed base URL is one problem, reported here and not again by the selection.
  const safeBaseUrl = (): string | undefined => {
    try {
      return readBaseUrl(env) ?? DEFAULTS.baseUrl;
    } catch (error) {
      problems.push(errorMessage(error));
      return undefined;
    }
  };
  const baseUrl = safeBaseUrl();
  const [first] = findKeys(env);
  const keyless = explicitProvider(env)?.keyless === true;
  const base: ConfigSummary = {
    hasApiKey: first !== undefined || keyless,
    apiKeyHint: first ? maskSecret(first.key) : null,
    baseUrl: baseUrl ?? "",
    model: env[ENV.model]?.trim() || DEFAULTS.model,
    timeoutMs: safeInt(ENV.timeoutMs, DEFAULTS.timeoutMs),
    maxRetries: safeInt(ENV.maxRetries, DEFAULTS.maxRetries),
    notes: first ? [] : heldBackKeys(env).map(heldBackNote),
  };
  const selected =
    baseUrl !== undefined && (first || keyless) ? selectOrReport(env, problems) : undefined;
  const summary: ConfigSummary = selected
    ? {
        ...base,
        apiKeyHint: selected.apiKey ? maskSecret(selected.apiKey) : null,
        provider: selected.provider.name,
        providerLabel: selected.provider.label,
        ...(selected.keyEnv ? { keyEnv: selected.keyEnv } : {}),
        baseUrl: selected.baseUrl,
        model: selected.model,
        notes: selected.notes,
      }
    : base;
  return problems.length ? { ...summary, problem: problems.join(" ") } : summary;
}

function selectOrReport(env: Env, problems: string[]): ProviderSelection | undefined {
  try {
    return selectProvider(env);
  } catch (error) {
    if (!(error instanceof JevConfigError)) throw error;
    problems.push(error.message);
    return undefined;
  }
}

/** Keep a short prefix and suffix so a user can recognise which key is loaded. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return "*".repeat(secret.length);
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}
