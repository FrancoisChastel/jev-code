import { JevClient } from "../core/client.js";
import type { Usage } from "../core/types.js";

type Env = Record<string, string | undefined>;

export interface LiveCheckOptions {
  /** Names the caller in User-Agent, e.g. `@french-castle/jev-code/0.5.1 doctor`. */
  userAgent: string;
  fetch?: ConstructorParameters<typeof JevClient>[0]["fetch"];
  /** Overrides JEV_CODE_MAX_RETRIES; setup uses 0 so a dead gateway fails fast. */
  maxRetries?: number;
}

export interface LiveCheckResult {
  ms: number;
  /** The model id the host reports, which may name the version behind an alias. */
  model: string;
  usage?: Usage;
}

/**
 * One cheap System One request with the configuration `env` resolves to, the same one for
 * `doctor --live` and setup's gateway check. Throws what the client throws.
 */
export async function liveCheck(env: Env, options: LiveCheckOptions): Promise<LiveCheckResult> {
  const started = Date.now();
  const client = JevClient.fromEnv(env, {
    userAgent: options.userAgent,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
  });
  const response = await client.systemOne({
    state: "ping",
    questions: { alive: { type: "noul", instructions: "Is this a single short word?" } },
  });
  return {
    ms: Date.now() - started,
    model: response.model,
    ...(response.usage ? { usage: response.usage } : {}),
  };
}
