import { DEFAULTS, resolveConfig } from "./config.js";
import { JevApiError, JevConnectionError, JevTimeoutError } from "./errors.js";
import type { SystemOneRequest, SystemOneResponse } from "./types.js";
import { SYSTEM_ONE_WIRE, WIRES, type Wire } from "./wires.js";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface JevClientOptions {
  /** Bearer token; omit for a local host such as Ollama, and no Authorization header is sent. */
  apiKey?: string;
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
/** Answers are a few kilobytes; anything near this is a misbehaving or hostile host. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;
/** Server-supplied text quoted in an error, which reaches the agent's context. */
const MAX_QUOTED_CHARS = 300;
const MAX_REQUEST_ID_CHARS = 100;

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
    this.apiKey = options.apiKey ?? "";
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
        try {
          return this.wire.decode(outcome.body, request, this.model, outcome.requestId);
        } catch (error) {
          throw this.scrub(error);
        }
      }
      outcome.error = this.scrub(outcome.error);
      const canRetry = attempt < this.maxRetries && outcome.retryable;
      if (!canRetry) throw outcome.error;
      const delay = outcome.retryAfterMs ?? backoffMs(attempt);
      attempt += 1;
      await this.sleep(delay);
    }
  }

  /**
   * Last line of defence for "keys are never echoed": an HTTP stack or a host that quotes the
   * Authorization header back would otherwise put the key where the agent or a library caller
   * reads it. Removes the key's exact value from the message and from an API error's body.
   */
  private scrub(error: unknown): Error {
    const failure = error instanceof Error ? error : new Error(String(error));
    const key = this.apiKey;
    if (!key) return failure;
    const escaped = JSON.stringify(key).slice(1, -1);
    const clean = (text: string): string =>
      text.split(key).join("<redacted>").split(escaped).join("<redacted>");
    if (failure instanceof JevApiError) {
      const raw = failure.body === undefined ? undefined : JSON.stringify(failure.body);
      const leaks = failure.message.includes(key) || (raw !== undefined && raw !== clean(raw));
      if (!leaks) return failure;
      return new JevApiError(
        clean(failure.message),
        failure.status,
        failure.requestId === undefined ? undefined : clean(failure.requestId),
        raw === undefined ? undefined : JSON.parse(clean(raw)),
      );
    }
    if (failure.message.includes(key)) failure.message = clean(failure.message);
    return failure;
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
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": this.userAgent,
          },
          body,
          signal: controller.signal,
          // One POST to the configured host: a redirect would resend the payload elsewhere.
          redirect: "manual",
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
      const requestId = quoted(response.headers.get(this.requestIdHeader), MAX_REQUEST_ID_CHARS);
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => {});
        return {
          kind: "error",
          retryable: false,
          error: new JevConnectionError(
            `${url} answered ${response.status} with a redirect, which jev-code does not follow. Point the base URL at the final address.`,
          ),
        };
      }
      let text: string;
      try {
        text = await readCapped(response, MAX_RESPONSE_BYTES);
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        const timedOut = controller.signal.reason instanceof JevTimeoutError;
        return {
          kind: "error",
          retryable: timedOut,
          error: timedOut
            ? new JevTimeoutError(`Jev request timed out after ${this.timeoutMs} ms.`)
            : new JevConnectionError(`Could not read the answer from ${url}: ${describe(error)}`),
        };
      }
      if (response.ok) {
        // Keep the raw text when it is not JSON, so a decode error still carries what came back.
        return { kind: "ok", body: tryParseJson(text) ?? text, requestId };
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
    if (typeof candidate === "string") return quoted(candidate) || "empty error message";
    if (!candidate || typeof candidate !== "object") break;
    current = candidate;
  }
  if (current && typeof current === "object") return quoted(JSON.stringify(current)) ?? "";
  return quoted(text) || "empty response body";
}

/**
 * Server text quoted into an error ends up in the agent's context: keep it short and on one
 * line, so a hostile host can neither flood the context nor fake structure with line breaks.
 */
function quoted(value: string | null | undefined, max = MAX_QUOTED_CHARS): string | undefined {
  if (value === null || value === undefined) return undefined;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Read the body as text, refusing more than `limit` bytes instead of buffering it all. */
async function readCapped(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`the answer is larger than ${limit} bytes`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new Error(`the answer is larger than ${limit} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
