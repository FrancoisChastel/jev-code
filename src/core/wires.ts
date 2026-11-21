/**
 * Wire formats. Every host serves the same judgment (state plus typed questions in, typed
 * answers with probabilities out), but the request shapes differ: TypeSafe's System One API
 * (also spoken by OpenRouter, Vercel, Perplexity, Microsoft Foundry, and Ollama), OpenAI's
 * Decisions API (also Azure OpenAI's), Gemini's Decisions API, and System One inside Cloudflare's
 * Workers AI envelope. A wire maps our
 * `SystemOneRequest` onto the host's body and the host's reply back onto `SystemOneResponse`,
 * so tools and adapters never see the difference.
 */
import { JevApiError } from "./errors.js";
import { oneLine } from "./text.js";
import type {
  Answer,
  Question,
  SystemOneRequest,
  SystemOneResponse,
  Text,
  Usage,
} from "./types.js";

export type WireName = "systemone" | "openai-decisions" | "gemini-decisions" | "workers-ai";

export interface Wire {
  readonly name: WireName;
  /** Path appended to the host's base URL, unless the host's table row names another. */
  readonly path: string;
  /** The JSON body to send. */
  encode(request: SystemOneRequest, model: string): unknown;
  /** Map a parsed 2xx body back to the System One shape; throw JevApiError when it cannot. */
  decode(
    body: unknown,
    request: SystemOneRequest,
    model: string,
    requestId?: string,
  ): SystemOneResponse;
}

function text(value: Text | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** TypeSafe's `POST /v1/systemone`: the request is sent as is, the reply is already our shape. */
export const SYSTEM_ONE_WIRE: Wire = {
  name: "systemone",
  path: "/v1/systemone",
  encode(request, model) {
    return { model, ...request };
  },
  decode(body, _request, _model, requestId) {
    if (!isRecord(body) || !isRecord(body.answers)) {
      throw new JevApiError("Jev API returned a body without answers.", 200, requestId, body);
    }
    return body as unknown as SystemOneResponse;
  },
};

/*
 * OpenAI's `POST /v1/decisions`, in public beta since 2026-10-06. Shape from OpenAI's API
 * reference (https://developers.openai.com/api/reference/resources/decisions/methods/create):
 *   { model, input, questions: [{ type: "predicate" | "choice" | "score", name, instructions,
 *     choices?: [{ value, description? }], levels?: [{ label, description? }] }] }
 *   { model, answers: [{ type, name, probability | choice + probabilities + confidence |
 *     score + probabilities + confidence } | { type: "refusal", name }], usage }
 * Differences from System One that the mapping absorbs: questions are an array with names,
 * yes/no criteria have no field of their own and are folded into the instructions, score
 * levels are labelled "0", "1", ... and their probabilities come back keyed by level index,
 * no legend comes back, so it is rebuilt from the request, and a question the model declines
 * comes back as a refusal, listed under `refused`.
 */
interface DecisionsQuestion {
  type: "predicate" | "choice" | "score";
  name: string;
  instructions?: string;
  choices?: Array<{ value: string; description?: string }>;
  levels?: Array<{ label: string; description?: string }>;
}

function toDecisionsQuestion(name: string, question: Question): DecisionsQuestion {
  const instructions = text(question.instructions);
  switch (question.type) {
    case "noul": {
      const lines = [instructions];
      const yes = text(question.criteria?.true);
      const no = text(question.criteria?.false);
      if (yes) lines.push(`Yes: ${yes}`);
      if (no) lines.push(`No: ${no}`);
      const folded = lines.filter((line) => line).join("\n");
      return { type: "predicate", name, ...(folded ? { instructions: folded } : {}) };
    }
    case "choice":
      return {
        type: "choice",
        name,
        ...(instructions ? { instructions } : {}),
        choices: Object.entries(question.criteria).map(([value, description]) => {
          const described = text(description);
          return described ? { value, description: described } : { value };
        }),
      };
    case "score":
      return {
        type: "score",
        name,
        ...(instructions ? { instructions } : {}),
        levels: question.criteria.map((description, index) => {
          const described = text(description);
          return { label: String(index), ...(described ? { description: described } : {}) };
        }),
      };
  }
}

/**
 * Probabilities arrive as `[{ value, probability }]`; key them by the first field present.
 * Choices are keyed by their value; score levels by their index (`value`), then their label.
 */
function distribution(
  entries: unknown,
  keys: readonly ("value" | "label")[],
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.probability !== "number") continue;
    const id = keys.map((key) => entry[key]).find((value) => value !== undefined && value !== null);
    if (id !== undefined) out[String(id)] = entry.probability;
  }
  return out;
}

function toAnswer(raw: Record<string, unknown>, question: Question): Answer | undefined {
  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
  switch (question.type) {
    case "noul":
      return typeof raw.probability === "number"
        ? { type: "noul", noul: raw.probability }
        : undefined;
    case "choice":
      if (typeof raw.choice !== "string") return undefined;
      return {
        type: "choice",
        choice: raw.choice,
        probabilities: distribution(raw.probabilities, ["value"]),
        confidence,
      };
    case "score": {
      if (typeof raw.score !== "number") return undefined;
      const legend: Record<string, Text> = {};
      question.criteria.forEach((description, index) => {
        legend[String(index)] = description;
      });
      return {
        type: "score",
        score: raw.score,
        legend,
        probabilities: distribution(raw.probabilities, ["value", "label"]),
        confidence,
      };
    }
  }
}

function toUsage(raw: unknown): Usage | undefined {
  if (!isRecord(raw)) return undefined;
  const { input_tokens, output_tokens } = raw;
  if (typeof input_tokens !== "number" || typeof output_tokens !== "number") return undefined;
  return { input_tokens, output_tokens };
}

export const OPENAI_DECISIONS_WIRE: Wire = {
  name: "openai-decisions",
  path: "/v1/decisions",
  encode(request, model) {
    const state = request.state;
    return {
      model: request.model ?? model,
      input: typeof state === "string" ? state : JSON.stringify(state),
      questions: Object.entries(request.questions).map(([name, question]) =>
        toDecisionsQuestion(name, question),
      ),
    };
  },
  decode(body, request, model, requestId) {
    if (!isRecord(body) || !Array.isArray(body.answers)) {
      throw new JevApiError("Decisions API returned a body without answers.", 200, requestId, body);
    }
    const answers: Record<string, Answer> = {};
    const declined = new Set<string>();
    for (const raw of body.answers) {
      if (!isRecord(raw) || typeof raw.name !== "string") continue;
      if (!Object.hasOwn(request.questions, raw.name)) continue;
      const question = request.questions[raw.name];
      if (!question) continue;
      if (raw.type === "refusal") {
        declined.add(raw.name);
        continue;
      }
      const answer = toAnswer(raw, question);
      if (answer) answers[raw.name] = answer;
    }
    // A question both refused and answered counts as answered.
    const refused = [...declined].filter((name) => !answers[name]);
    const usage = toUsage(body.usage);
    return {
      model: typeof body.model === "string" ? body.model : (request.model ?? model),
      answers,
      ...(refused.length ? { refused } : {}),
      ...(usage ? { usage } : {}),
    };
  },
};

/*
 * Gemini's `POST /v1beta/decisions` (gemini-decision-1, 2026-11-11). It keeps System One's map of
 * questions, its type names, and its answer shapes, with three renames the mapping absorbs:
 * the state is `input` (a list there would be read as content blocks, so JSON state is sent as
 * its text, as Google's own examples do), yes/no criteria are `true_description` and
 * `false_description`, and usage counts are `total_input_tokens` and `total_output_tokens`.
 * A `noul` answer also carries a confidence, which System One has no field for.
 */
function toGeminiQuestion(question: Question): Record<string, unknown> {
  const instructions = text(question.instructions) ?? "";
  switch (question.type) {
    case "noul": {
      const yes = text(question.criteria?.true);
      const no = text(question.criteria?.false);
      const criteria = {
        ...(yes ? { true_description: yes } : {}),
        ...(no ? { false_description: no } : {}),
      };
      return { type: "noul", instructions, ...(yes || no ? { criteria } : {}) };
    }
    case "choice":
      return {
        type: "choice",
        instructions,
        criteria: Object.fromEntries(
          Object.entries(question.criteria).map(([label, description]) => [
            label,
            text(description) ?? label,
          ]),
        ),
      };
    case "score":
      return {
        type: "score",
        instructions,
        criteria: question.criteria.map((level, index) => text(level) ?? `Level ${index}`),
      };
  }
}

function fromGeminiAnswer(raw: unknown, question: Question): Answer | undefined {
  if (!isRecord(raw)) return undefined;
  const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
  const probabilities = isRecord(raw.probabilities)
    ? (Object.fromEntries(
        Object.entries(raw.probabilities).filter(([, value]) => typeof value === "number"),
      ) as Record<string, number>)
    : {};
  switch (question.type) {
    case "noul":
      return typeof raw.noul === "number" ? { type: "noul", noul: raw.noul } : undefined;
    case "choice":
      return typeof raw.choice === "string"
        ? { type: "choice", choice: raw.choice, probabilities, confidence }
        : undefined;
    case "score": {
      if (typeof raw.score !== "number") return undefined;
      // Rebuilt from the request, as for OpenAI: the levels are ours, the host's copy adds nothing.
      const legend: Record<string, Text> = Object.fromEntries(
        question.criteria.map((level, index) => [String(index), level]),
      );
      return { type: "score", score: raw.score, legend, probabilities, confidence };
    }
  }
}

function fromGeminiUsage(raw: unknown): Usage | undefined {
  if (!isRecord(raw)) return undefined;
  const input = raw.total_input_tokens ?? raw.input_tokens;
  const output = raw.total_output_tokens ?? raw.output_tokens ?? 0;
  if (typeof input !== "number" || typeof output !== "number") return undefined;
  return { input_tokens: input, output_tokens: output };
}

export const GEMINI_DECISIONS_WIRE: Wire = {
  name: "gemini-decisions",
  path: "/v1beta/decisions",
  encode(request, model) {
    const state = request.state;
    return {
      model: request.model ?? model,
      input: typeof state === "string" ? state : JSON.stringify(state),
      questions: Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => [id, toGeminiQuestion(question)]),
      ),
    };
  },
  decode(body, request, model, requestId) {
    if (!isRecord(body) || !isRecord(body.answers)) {
      throw new JevApiError(
        "Gemini Decisions API returned a body without answers.",
        200,
        requestId,
        body,
      );
    }
    const answers: Record<string, Answer> = {};
    for (const [id, question] of Object.entries(request.questions)) {
      const answer = fromGeminiAnswer(body.answers[id], question);
      if (answer) answers[id] = answer;
    }
    const usage = fromGeminiUsage(body.usage);
    return {
      model: typeof body.model === "string" ? body.model : (request.model ?? model),
      answers,
      ...(usage ? { usage } : {}),
    };
  },
};

/*
 * Cloudflare Workers AI runs Clef behind `POST /accounts/<id>/ai/run/@cf/cloudflare/<model>`
 * with the System One body, and its REST API wraps every model's output in
 * `{ result, success, errors, messages }`. The wire unwraps `result` and reads the rest as
 * System One; a body that is already bare (a binding or a proxy that unwrapped it) passes too.
 */
export const WORKERS_AI_WIRE: Wire = {
  name: "workers-ai",
  path: "",
  encode: SYSTEM_ONE_WIRE.encode,
  decode(body, request, model, requestId) {
    const inner = isRecord(body) && isRecord(body.result) ? body.result : body;
    return SYSTEM_ONE_WIRE.decode(inner, request, model, requestId);
  },
};

export const WIRES: Readonly<Record<WireName, Wire>> = {
  systemone: SYSTEM_ONE_WIRE,
  "openai-decisions": OPENAI_DECISIONS_WIRE,
  "gemini-decisions": GEMINI_DECISIONS_WIRE,
  "workers-ai": WORKERS_AI_WIRE,
};

const MAX_MODEL_CHARS = 100;

function numbersOver(
  raw: Record<string, number> | undefined,
  allowed: (key: string) => boolean,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (allowed(key) && typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The answer in the question's own terms, or undefined when it does not fit the question. */
function keptAnswer(answer: unknown, question: Question): Answer | undefined {
  if (!isRecord(answer) || answer.type !== question.type) return undefined;
  switch (question.type) {
    case "noul":
      return typeof answer.noul === "number" && Number.isFinite(answer.noul)
        ? { type: "noul", noul: answer.noul }
        : undefined;
    case "choice": {
      const offered = (label: string) => Object.hasOwn(question.criteria, label);
      if (typeof answer.choice !== "string" || !offered(answer.choice)) return undefined;
      return {
        type: "choice",
        choice: answer.choice,
        probabilities: numbersOver(answer.probabilities as Record<string, number>, offered),
        confidence: finite(answer.confidence),
      };
    }
    case "score": {
      if (typeof answer.score !== "number" || !Number.isFinite(answer.score)) return undefined;
      const legend: Record<string, Text> = Object.fromEntries(
        question.criteria.map((level, index) => [String(index), level]),
      );
      const probabilities = numbersOver(answer.probabilities as Record<string, number>, (key) =>
        Object.hasOwn(legend, key),
      );
      return {
        type: "score",
        score: answer.score,
        legend,
        ...(isRecord(answer.probabilities) ? { probabilities } : {}),
        confidence: finite(answer.confidence),
      };
    }
  }
}

/**
 * Every wire's answer passes through here before a tool sees it, so a host can only answer in
 * the request's own terms: answers to the questions asked, a choice among the labels offered,
 * probabilities over those labels or levels, the levels' legend as the caller wrote it, and a
 * model name that is short and on one line. A successful reply cannot put text of the host's
 * own in front of the agent.
 */
export function bounded(
  response: SystemOneResponse,
  request: SystemOneRequest,
  model: string,
): SystemOneResponse {
  const asked = (name: string) => Object.hasOwn(request.questions, name);
  const answers: Record<string, Answer> = {};
  for (const [name, answer] of Object.entries(isRecord(response.answers) ? response.answers : {})) {
    const question = asked(name) ? request.questions[name] : undefined;
    const kept = question ? keptAnswer(answer, question) : undefined;
    if (kept) answers[name] = kept;
  }
  const refused = Array.isArray(response.refused)
    ? response.refused.filter((name) => typeof name === "string" && asked(name) && !answers[name])
    : [];
  const named = typeof response.model === "string" ? oneLine(response.model, MAX_MODEL_CHARS) : "";
  const usage = response.usage;
  const counted =
    isRecord(usage) &&
    typeof usage.input_tokens === "number" &&
    typeof usage.output_tokens === "number";
  return {
    model: named || model,
    answers,
    ...(refused.length ? { refused } : {}),
    ...(counted
      ? { usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } }
      : {}),
  };
}
