/**
 * Wire formats. Every host serves the same judgment (state plus typed questions in, typed
 * answers with probabilities out), but two request shapes exist: TypeSafe's System One API,
 * which OpenRouter and Vercel also speak, and OpenAI's Decisions API. A wire maps our
 * `SystemOneRequest` onto the host's body and the host's reply back onto `SystemOneResponse`,
 * so tools and adapters never see the difference.
 */
import { JevApiError } from "./errors.js";
import type {
  Answer,
  Question,
  SystemOneRequest,
  SystemOneResponse,
  Text,
  Usage,
} from "./types.js";

export type WireName = "systemone" | "openai-decisions";

export interface Wire {
  readonly name: WireName;
  /** Path appended to the host's base URL. */
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
 * OpenAI's `POST /v1/decisions` (limited preview). Shape taken from traffic recorded by a
 * preview user and from OpenAI's own client in the Codex repository:
 *   { model, input, questions: [{ type: "predicate" | "choice" | "score", name, instructions,
 *     choices?: [{ value, description? }], levels?: [{ label, description }] }] }
 *   { model, answers: [{ type, name, probability | choice + probabilities + confidence |
 *     score + probabilities + confidence }], usage: { input_tokens, output_tokens } }
 * Differences from System One that the mapping absorbs: questions are an array with names,
 * yes/no criteria have no field of their own and are folded into the instructions, score
 * levels are labelled "0", "1", ... so probabilities map back to positions, and no legend
 * comes back, so it is rebuilt from the request.
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

function distribution(entries: unknown, key: "value" | "label"): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.probability !== "number") continue;
    const id = entry[key] ?? entry.value;
    if (id !== undefined && id !== null) out[String(id)] = entry.probability;
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
        probabilities: distribution(raw.probabilities, "value"),
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
        probabilities: distribution(raw.probabilities, "label"),
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
    for (const raw of body.answers) {
      if (!isRecord(raw) || typeof raw.name !== "string") continue;
      const question = request.questions[raw.name];
      if (!question) continue;
      const answer = toAnswer(raw, question);
      if (answer) answers[raw.name] = answer;
    }
    const usage = toUsage(body.usage);
    return {
      model: typeof body.model === "string" ? body.model : (request.model ?? model),
      answers,
      ...(usage ? { usage } : {}),
    };
  },
};

export const WIRES: Readonly<Record<WireName, Wire>> = {
  systemone: SYSTEM_ONE_WIRE,
  "openai-decisions": OPENAI_DECISIONS_WIRE,
};
