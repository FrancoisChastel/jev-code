import { DEFAULTS, resolveConfig } from "./config.js";
import { JevApiError, JevConnectionError, JevTimeoutError } from "./errors.js";
import type { SystemOneRequest, SystemOneResponse } from "./types.js";
import { SYSTEM_ONE_WIRE, WIRES, type Wire } from "./wires.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface JevClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: FetchLike;
  userAgent?: string;
  /** Extra request headers, sent under the fixed ones (a caller cannot override Authorization). */
  headers?: Record<string, string>;
  /** Response header carrying the request id; defaults to TypeSafe's. */
  requestIdHeader?: string;
  /** Request shape the host speaks; System One unless the host is OpenAI's Decisions API. */
  wire?: Wire;
  /** Injected for tests; defaults to a real sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** Path of TypeSafe's endpoint; kept for callers that build URLs themselves. */
export const SYSTEM_ONE_PATH = SYSTEM_ONE_WIRE.path;
export const REQUEST_ID_HEADER = "x-typesafe-request-id";

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 529]);
const BACKOFF_INITIAL_MS = 500;
const BACKOFF_MAX_MS = 8_000;
const MAX_RETRY_AFTER_MS = 30_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal client for `POST /v1/systemone` with retries on rate limits and transient failures. */
export class JevClient {
  readonly baseUrl: string;
  readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;
  private readonly userAgent: string;
  private readonly headers: Record<string, string>;
  private readonly requestIdHeader: string;
  private readonly wire: Wire;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: JevClientOptions) {
    if (!options.apiKey) throw new JevConnectionError("JevClient requires an apiKey.");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULTS.baseUrl).replace(/\/+$/, "");
    this.model = options.model ?? DEFAULTS.model;
    this.timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
    this.maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.userAgent = options.userAgent ?? "jev-code";
    this.headers = { ...options.headers };
    this.requestIdHeader = options.requestIdHeader ?? REQUEST_ID_HEADER;
    this.wire = options.wire ?? SYSTEM_ONE_WIRE;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Build a client from the environment: the first provider key found picks the host
   * (TypeSafe, OpenRouter, or Vercel AI Gateway), see `resolveConfig`.
   */
  static fromEnv(
    env: Record<string, string | undefined> = process.env,
    overrides: Partial<Omit<JevClientOptions, "apiKey">> = {},
  ): JevClient {
    const { apiKey, baseUrl, model, timeoutMs, maxRetries, headers, requestIdHeader, wire } =
      resolveConfig(env);
    return new JevClient({
      apiKey,
      baseUrl,
      model,
      timeoutMs,
      maxRetries,
      wire: WIRES[wire],
      ...(requestIdHeader ? { requestIdHeader } : {}),
      ...overrides,
      headers: { ...headers, ...overrides.headers },
    });
  }

  /** Send state and questions; resolve with typed answers. */
  async systemOne(
    request: SystemOneRequest,
    options: RequestOptions = {},
  ): Promise<SystemOneResponse> {
    const body = JSON.stringify(this.wire.encode(request, this.model));
    const url = `${this.baseUrl}${this.wire.path}`;
    let attempt = 0;
    for (;;) {
      options.signal?.throwIfAborted();
      const outcome = await this.attempt(url, body, options.signal);
      if (outcome.kind === "ok") {
        return this.wire.decode(outcome.body, request, this.model, outcome.requestId);
      }
      const canRetry = attempt < this.maxRetries && outcome.retryable;
      if (!canRetry) throw outcome.error;
      const delay = outcome.retryAfterMs ?? backoffMs(attempt);
      attempt += 1;
      await this.sleep(delay);
    }
  }

  private async attempt(
    url: string,
    body: string,
    signal: AbortSignal | undefined,
  ): Promise<AttemptOutcome> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new JevTimeoutError("timeout")),
      this.timeoutMs,
    );
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "POST",
          headers: {
            ...this.headers,
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": this.userAgent,
          },
          body,
          signal: controller.signal,
        });
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (controller.signal.reason instanceof JevTimeoutError) {
          return {
            kind: "error",
            retryable: true,
            error: new JevTimeoutError(`Jev request timed out after ${this.timeoutMs} ms.`),
          };
        }
        return {
          kind: "error",
          retryable: true,
          error: new JevConnectionError(`Could not reach ${url}: ${describe(error)}`),
        };
      }
      const requestId = response.headers.get(this.requestIdHeader) ?? undefined;
      const text = await response.text();
      if (response.ok) {
        return { kind: "ok", body: tryParseJson(text), requestId };
      }
      const parsed = tryParseJson(text);
      const error = new JevApiError(
        `Jev API error ${response.status}${requestId ? ` (request ${requestId})` : ""}: ${summarise(parsed, text)}`,
        response.status,
        requestId,
        parsed ?? text,
      );
      return {
        kind: "error",
        retryable: RETRYABLE_STATUSES.has(response.status),
        retryAfterMs: retryAfterMs(response.headers),
        error,
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

type AttemptOutcome =
  | { kind: "ok"; body: unknown; requestId: string | undefined }
  | { kind: "error"; retryable: boolean; retryAfterMs?: number; error: Error };

function backoffMs(attempt: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_INITIAL_MS * 2 ** attempt);
  const jitter = base * 0.25 * Math.random();
  return Math.round(base - jitter);
}

/** Honour `retry-after-ms` or `retry-after` (seconds), capped so a bad header cannot stall. */
export function retryAfterMs(headers: Headers): number | undefined {
  const ms = headers.get("retry-after-ms");
  if (ms !== null) {
    const value = Number(ms);
    if (Number.isFinite(value) && value >= 0) return Math.min(value, MAX_RETRY_AFTER_MS);
  }
  const seconds = headers.get("retry-after");
  if (seconds !== null) {
    const value = Number(seconds);
    if (Number.isFinite(value) && value >= 0) return Math.min(value * 1000, MAX_RETRY_AFTER_MS);
  }
  return undefined;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Pull a readable message out of an error body. Hosts nest it differently: TypeSafe under
 * `detail`, OpenRouter under `error`, Vercel at the top level; two levels cover them all.
 */
function summarise(parsed: unknown, text: string): string {
  let current = parsed;
  for (let depth = 0; depth < 2 && current && typeof current === "object"; depth += 1) {
    const record = current as Record<string, unknown>;
    const candidate = record.message ?? record.error ?? record.detail;
    if (typeof candidate === "string") return candidate;
    if (!candidate || typeof candidate !== "object") break;
    current = candidate;
  }
  if (current && typeof current === "object") return JSON.stringify(current).slice(0, 300);
  return text.slice(0, 300) || "empty response body";
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
