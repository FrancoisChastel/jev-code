import { errorMessage, JevConfigError } from "./errors.js";
import {
  DEFAULT_PROVIDER,
  PROVIDER_NAMES,
  PROVIDERS,
  type Provider,
  type ProviderName,
  providerByName,
  providerForKey,
  providerForUrl,
} from "./providers.js";
import type { WireName } from "./wires.js";

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
  /** Host implied by the key's prefix, or by the variable when the prefix is unknown. */
  provider: Provider;
  /** True when the prefix, not the variable, decided the host. */
  byPrefix: boolean;
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

/** The provider JEV_CODE_PROVIDER names, when it names a known one. */
function explicitProvider(env: Env): Provider | undefined {
  const name = env[ENV.provider]?.trim();
  return name ? providerByName(name) : undefined;
}

/**
 * Every key variable that is set, in precedence order, each routed by its prefix. Keys that
 * belong to an opt-in host are left out unless JEV_CODE_PROVIDER names that host.
 */
function findKeys(env: Env): KeyCandidate[] {
  const explicit = explicitProvider(env);
  const out: KeyCandidate[] = [];
  for (const provider of PROVIDERS) {
    const key = env[provider.keyEnv]?.trim();
    if (!key) continue;
    const issuer = providerForKey(key);
    const target = issuer ?? provider;
    if (target.explicitOnly && explicit?.name !== target.name) continue;
    out.push({ keyEnv: provider.keyEnv, key, provider: target, byPrefix: !!issuer });
  }
  return out;
}

/** Keys that are set but belong to an opt-in host nobody asked for, so the user can be told. */
function heldBackKeys(env: Env): KeyCandidate[] {
  const explicit = explicitProvider(env);
  const out: KeyCandidate[] = [];
  for (const provider of PROVIDERS) {
    const key = env[provider.keyEnv]?.trim();
    if (!key) continue;
    const target = providerForKey(key) ?? provider;
    if (target.explicitOnly && explicit?.name !== target.name) {
      out.push({ keyEnv: provider.keyEnv, key, provider: target, byPrefix: true });
    }
  }
  return out;
}

function heldBackNote(candidate: KeyCandidate): string {
  const { keyEnv, provider } = candidate;
  return `${keyEnv} holds ${article(provider.label)} ${provider.label} key; that host is used only when ${ENV.provider}=${provider.name} is set.`;
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
function selectKeyless(env: Env, provider: Provider): ProviderSelection {
  const explicitUrl = env[ENV.baseUrl]?.trim();
  const hostValue = provider.hostEnv ? env[provider.hostEnv]?.trim() : undefined;
  const baseUrl = explicitUrl
    ? explicitUrl.replace(/\/+$/, "")
    : hostValue
      ? serverUrlFromHost(hostValue)
      : provider.baseUrl;
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
  const optIn = PROVIDERS.filter((p) => p.explicitOnly).map((p) =>
    p.keyless
      ? ` ${p.label}: set ${ENV.provider}=${p.name} (no key; ${p.hostEnv} names a server other than ${p.baseUrl}).`
      : ` ${p.label}: export ${p.keyEnv} and set ${ENV.provider}=${p.name}.`,
  );
  const held = heldBackKeys(env).map((c) => ` ${heldBackNote(c)}`);
  return new JevConfigError(
    `No API key found. Export one of ${options.join(", ")}, or ${last}.${held.join("") || optIn.join("")}`,
  );
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** Describe what is set, for the error raised when none of it fits the requested host. */
function describeCandidates(candidates: readonly KeyCandidate[]): string {
  return candidates
    .map((c) =>
      c.byPrefix
        ? `${c.keyEnv} (${article(c.provider.label)} ${c.provider.label} key)`
        : `${c.keyEnv} (unrecognised prefix)`,
    )
    .join(", ");
}

/** Observations worth showing next to a successful selection. */
function selectionNotes(
  chosen: KeyCandidate,
  candidates: readonly KeyCandidate[],
  provider: Provider,
  baseUrlOverride: string | undefined,
): string[] {
  const notes: string[] = [];
  if (baseUrlOverride && !providerForUrl(baseUrlOverride)) {
    notes.push(
      `Requests go to ${baseUrlOverride} (${ENV.baseUrl}) with the ${provider.label} key.`,
    );
  }
  if (chosen.byPrefix && chosen.keyEnv !== chosen.provider.keyEnv) {
    notes.push(
      `${chosen.keyEnv} holds ${article(chosen.provider.label)} ${chosen.provider.label} key; requests go to ${chosen.provider.label}. Prefer ${chosen.provider.keyEnv} for that key.`,
    );
  }
  const others = candidates.filter((c) => c !== chosen);
  if (others.length > 0) {
    const names = [chosen, ...others].map((c) => c.keyEnv);
    const switches = [...new Set(others.map((c) => c.provider.name))]
      .filter((name) => name !== provider.name)
      .map((name) => `${ENV.provider}=${name}`);
    const hint = switches.length ? ` Set ${switches.join(" or ")} to switch.` : "";
    notes.push(
      `${names.join(" and ")} are ${names.length > 2 ? "all" : "both"} set; using ${provider.label} (${chosen.keyEnv}).${hint}`,
    );
  }
  return notes;
}

/**
 * Pick the host and the key from the environment.
 *
 * A key's prefix says which host issued it; a key with an unknown prefix belongs to the host
 * of the variable it sits in. `JEV_CODE_PROVIDER`, or a `TYPESAFE_BASE_URL` on a known host,
 * forces the host, and then only a key that belongs to that host is used. Otherwise the first
 * key set wins. A key is never sent to a host that did not issue it. Throws `JevConfigError`
 * when nothing usable is set.
 */
export function selectProvider(env: Env): ProviderSelection {
  const explicitName = env[ENV.provider]?.trim();
  const explicit = explicitName ? providerByName(explicitName) : undefined;
  if (explicitName && !explicit) {
    throw new JevConfigError(
      `${ENV.provider} must be one of ${PROVIDER_NAMES.join(", ")}, got "${explicitName}".`,
    );
  }
  if (explicit?.keyless) return selectKeyless(env, explicit);
  const baseUrlOverride = env[ENV.baseUrl]?.trim() || undefined;
  const urlProvider = baseUrlOverride ? providerForUrl(baseUrlOverride) : undefined;
  if (explicit && urlProvider && explicit.name !== urlProvider.name) {
    throw new JevConfigError(
      `${ENV.provider}=${explicit.name} but ${ENV.baseUrl} points at ${urlProvider.label} (${urlProvider.host}). Change one of them.`,
    );
  }

  const candidates = findKeys(env);
  const [first] = candidates;
  if (!first) throw missingKeyError(env);

  const target = explicit ?? urlProvider;
  const chosen = target ? candidates.find((c) => c.provider.name === target.name) : first;
  if (!chosen || !target) {
    if (chosen) {
      return finishSelection(env, chosen, candidates, chosen.provider, baseUrlOverride);
    }
    const wanted = target ?? first.provider;
    const held = heldBackKeys(env).find((c) => c.provider.name === wanted.name);
    if (held) {
      throw new JevConfigError(
        `${ENV.baseUrl} points at ${wanted.label} (${wanted.host}), but ${heldBackNote(held)}`,
      );
    }
    const reason = explicit
      ? `${ENV.provider}=${explicit.name}`
      : `${ENV.baseUrl} points at ${wanted.label} (${wanted.host})`;
    const fix = explicit ? `unset ${ENV.provider}` : `unset ${ENV.baseUrl}`;
    throw new JevConfigError(
      `${reason}, but no ${wanted.label} key is set; found ${describeCandidates(candidates)}. Keys are sent only to the host that issued them: export ${wanted.keyEnv}, or ${fix}.`,
    );
  }
  return finishSelection(env, chosen, candidates, target, baseUrlOverride);
}

/**
 * A base URL on an unrecognised host (a proxy) is applied to a TypeSafe key as it always was.
 * For another host's key it needs `JEV_CODE_PROVIDER` to state the intent; otherwise an
 * ambient OpenRouter or Vercel key must not follow a TypeSafe-named override to a stranger.
 */
function assertProxyIsIntended(
  env: Env,
  provider: Provider,
  chosen: KeyCandidate,
  baseUrlOverride: string | undefined,
): void {
  if (!baseUrlOverride || providerForUrl(baseUrlOverride)) return;
  if (provider.name === DEFAULT_PROVIDER.name || env[ENV.provider]?.trim()) return;
  throw new JevConfigError(
    `${ENV.baseUrl} points at an unrecognised host (${baseUrlOverride}) while the key in use is ${article(provider.label)} ${provider.label} key (${chosen.keyEnv}). A custom base URL applies to TypeSafe keys only, unless ${ENV.provider}=${provider.name} says the proxy is meant for ${provider.label}.`,
  );
}

function finishSelection(
  env: Env,
  chosen: KeyCandidate,
  candidates: readonly KeyCandidate[],
  provider: Provider,
  baseUrlOverride: string | undefined,
): ProviderSelection {
  assertProxyIsIntended(env, provider, chosen, baseUrlOverride);
  return {
    provider,
    keyEnv: chosen.keyEnv,
    apiKey: chosen.key,
    baseUrl: (baseUrlOverride ?? provider.baseUrl).replace(/\/+$/, ""),
    model: env[ENV.model]?.trim() || provider.model,
    notes: selectionNotes(chosen, candidates, provider, baseUrlOverride),
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
  /** Why the configuration cannot be used, when keys are present but conflict. */
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
  const [first] = findKeys(env);
  const keyless = explicitProvider(env)?.keyless === true;
  const base: ConfigSummary = {
    hasApiKey: first !== undefined || keyless,
    apiKeyHint: first ? maskSecret(first.key) : null,
    baseUrl: (env[ENV.baseUrl]?.trim() || DEFAULTS.baseUrl).replace(/\/+$/, ""),
    model: env[ENV.model]?.trim() || DEFAULTS.model,
    timeoutMs: safeInt(ENV.timeoutMs, DEFAULTS.timeoutMs),
    maxRetries: safeInt(ENV.maxRetries, DEFAULTS.maxRetries),
    notes: first ? [] : heldBackKeys(env).map(heldBackNote),
  };
  const selected = first || keyless ? selectOrReport(env, problems) : undefined;
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
