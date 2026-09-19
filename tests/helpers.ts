import { JevClient } from "../src/core/client.js";
import type { Answer, SystemOneRequest, SystemOneResponse } from "../src/core/types.js";

export interface RecordedCall {
  url: string;
  init: RequestInit;
  body: SystemOneRequest & { model: string };
}

/** A fetch stub that records requests and answers from a queue of responders. */
export function fakeFetch(
  responders: Array<(body: SystemOneRequest) => Response | Promise<Response>>,
): {
  fetch: JevClient["systemOne"] extends never
    ? never
    : NonNullable<ConstructorParameters<typeof JevClient>[0]["fetch"]>;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url, init: init ?? {}, body });
    const responder = responders.shift();
    if (!responder) throw new Error(`Unexpected request #${calls.length} to ${url}`);
    return responder(body);
  };
  return { fetch, calls };
}

export function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Build a client whose responses come from an answer generator, so tools can be tested offline. */
export function clientWith(
  answerFor: (id: string, request: SystemOneRequest) => Answer | undefined,
  extra: Partial<SystemOneResponse> = {},
): { client: JevClient; calls: RecordedCall[] } {
  const { fetch, calls } = fakeFetch([
    (body) => {
      const answers: Record<string, Answer> = {};
      for (const id of Object.keys(body.questions)) {
        const answer = answerFor(id, body);
        if (answer) answers[id] = answer;
      }
      return jsonResponse({
        model: "jev-latest",
        answers,
        usage: { input_tokens: 10, output_tokens: 2 },
        ...extra,
      });
    },
  ]);
  const client = new JevClient({ apiKey: "ts_test", fetch, sleep: async () => {}, maxRetries: 0 });
  return { client, calls };
}

export const choice = (
  choice: string,
  probabilities: Record<string, number>,
  confidence = 0.9,
): Answer => ({
  type: "choice",
  choice,
  probabilities,
  confidence,
});

export const noul = (value: number): Answer => ({ type: "noul", noul: value });

export const score = (
  value: number,
  confidence: number,
  probabilities?: Record<string, number>,
): Answer => ({
  type: "score",
  score: value,
  legend: {},
  confidence,
  ...(probabilities ? { probabilities } : {}),
});
