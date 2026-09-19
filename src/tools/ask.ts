import type { JevClient, RequestOptions } from "../core/client.js";
import { JevValidationError } from "../core/errors.js";
import type { Question, Questions, State, SystemOneResponse, Text } from "../core/types.js";
import { assertRequestBudget } from "./common.js";
import { parseInput, type ToolDefinition } from "./definition.js";
import { type AskInput, askInputSchema } from "./schemas.js";

export type AskOutput = SystemOneResponse;

/**
 * Reject criteria shapes the API refuses, with the caller's own path in the message.
 * Unknown shapes for a known type are the only thing checked; the API stays the authority.
 */
export function validateQuestion(id: string, question: AskInput["questions"][string]): Question {
  const { type, instructions, criteria } = question;
  if (instructions === undefined || instructions === null || instructions === "") {
    throw new JevValidationError(`questions["${id}"].instructions is required.`);
  }
  switch (type) {
    case "choice": {
      if (!isPlainObject(criteria) || Object.keys(criteria).length < 2) {
        throw new JevValidationError(
          `questions["${id}"].criteria: choice criteria must be an object mapping at least 2 options to a description or null, got ${kind(criteria)}.`,
        );
      }
      return { type, instructions, criteria: criteria as Record<string, Text> };
    }
    case "score": {
      if (!Array.isArray(criteria) || criteria.length < 2) {
        throw new JevValidationError(
          `questions["${id}"].criteria: score criteria must be an array of at least 2 level descriptions ordered low to high, got ${kind(criteria)}.`,
        );
      }
      return { type, instructions, criteria };
    }
    case "noul": {
      if (criteria !== undefined && criteria !== null && !isPlainObject(criteria)) {
        throw new JevValidationError(
          `questions["${id}"].criteria: noul criteria must be an object with "true" and "false" descriptions, or omitted, got ${kind(criteria)}.`,
        );
      }
      return criteria === undefined
        ? { type, instructions }
        : { type, instructions, criteria: criteria as { true?: Text; false?: Text } };
    }
  }
}

export async function runAsk(
  client: JevClient,
  rawInput: unknown,
  options: RequestOptions = {},
): Promise<AskOutput> {
  const input = parseInput(askInputSchema, rawInput, "jev_ask");
  const questions: Questions = {};
  for (const [id, question] of Object.entries(input.questions)) {
    questions[id] = validateQuestion(id, question);
  }
  const request = {
    state: input.state as State,
    questions,
    ...(input.model ? { model: input.model } : {}),
  };
  assertRequestBudget(request);
  return client.systemOne(request, options);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kind(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length ? "an array" : "an empty array";
  if (typeof value === "object")
    return Object.keys(value as object).length ? "an object" : "an empty object";
  return `a ${typeof value}`;
}

export const askTool: ToolDefinition<AskInput, AskOutput> = {
  name: "jev_ask",
  title: "Jev ask",
  promptSnippet:
    "Raw Jev call: state plus typed questions (noul, choice, score) in, typed answers with probabilities out.",
  description:
    "Raw access to Jev, TypeSafe's System One model: send state plus typed questions and get typed answers with calibrated probabilities. " +
    "Question types: noul (probability a yes/no condition holds), choice (one option from a map, with probabilities and confidence), " +
    "score (position on ordered levels, with confidence). Use it when the other jev_* tools do not fit: mixed question types over one state, " +
    "speculative questions whose answers only matter for some inputs, or a custom decomposition. All questions in a call see the same state and " +
    "run in parallel. Question ids are not sent to the model, so write the complete judgment in instructions. Not for prose or code generation.",
  guidelines: [
    "With jev_ask, batch every question about the same state into one call, including speculative ones, and let code pick the answers it needs.",
  ],
  schema: askInputSchema,
  run: runAsk,
};
