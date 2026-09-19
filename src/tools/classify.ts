import type { JevClient, RequestOptions } from "../core/client.js";
import { JevValidationError } from "../core/errors.js";
import type { ChoiceQuestion, Questions, Usage } from "../core/types.js";
import {
  assertRequestBudget,
  buildState,
  contextValue,
  itemsToState,
  prepareItems,
  round,
} from "./common.js";
import { parseInput, type ToolDefinition } from "./definition.js";
import { classifyDecision, type Decision, marginOf, topProbability } from "./policy.js";
import { type ClassifyInput, classifyInputSchema } from "./schemas.js";

export const CLASSIFY_DEFAULTS = { autoAccept: 0.85, minMargin: 0.5 } as const;

export interface ClassifyResult {
  id: string;
  label: string | null;
  probability: number;
  margin: number;
  confidence: number;
  decision: Decision;
  probabilities: Record<string, number>;
  truncated?: true;
  status?: "invalid_response";
}

export interface ClassifyOutput {
  summary: {
    items: number;
    auto: number;
    review: number;
    by_label: Record<string, number>;
  };
  results: ClassifyResult[];
  thresholds: { auto_accept: number; min_margin: number };
  model: string;
  usage?: Usage;
}

export async function runClassify(
  client: JevClient,
  rawInput: unknown,
  options: RequestOptions = {},
): Promise<ClassifyOutput> {
  const input = parseInput(classifyInputSchema, rawInput, "jev_classify");
  const autoAccept = input.auto_accept ?? CLASSIFY_DEFAULTS.autoAccept;
  const minMargin = input.min_margin ?? CLASSIFY_DEFAULTS.minMargin;
  const items = prepareItems(input.items);
  const purpose = input.instructions?.trim();
  const questions: Questions = {};
  for (const item of items) {
    const question: ChoiceQuestion = {
      type: "choice",
      instructions: `${purpose ? `${purpose} ` : ""}Which class best describes \`items.${item.key}\`? Judge it on its own; other items are unrelated.`,
      criteria: input.classes,
    };
    questions[item.key] = question;
  }
  const request = {
    state: buildState({ context: contextValue(input.context), items: itemsToState(items) }),
    questions,
  };
  assertRequestBudget(request);

  const response = await client.systemOne(request, options);
  const byLabel: Record<string, number> = {};
  let auto = 0;
  const results: ClassifyResult[] = items.map((item) => {
    const answer = response.answers[item.key];
    if (answer?.type !== "choice" || typeof answer.choice !== "string") {
      return {
        id: item.id,
        label: null,
        probability: 0,
        margin: 0,
        confidence: 0,
        decision: "review",
        probabilities: {},
        status: "invalid_response",
        ...(item.truncated ? { truncated: true as const } : {}),
      };
    }
    const margin = marginOf(answer.probabilities);
    const probability = answer.probabilities[answer.choice] ?? topProbability(answer.probabilities);
    const decision = classifyDecision(probability, margin, autoAccept, minMargin);
    if (decision === "auto") auto += 1;
    byLabel[answer.choice] = (byLabel[answer.choice] ?? 0) + 1;
    return {
      id: item.id,
      label: answer.choice,
      probability: round(probability),
      margin: round(margin),
      confidence: round(answer.confidence),
      decision,
      probabilities: roundAll(answer.probabilities),
      ...(item.truncated ? { truncated: true as const } : {}),
    };
  });

  return {
    summary: { items: results.length, auto, review: results.length - auto, by_label: byLabel },
    results,
    thresholds: { auto_accept: autoAccept, min_margin: minMargin },
    model: response.model,
    ...(response.usage ? { usage: response.usage } : {}),
  };
}

export function roundAll(probabilities: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(probabilities)) out[key] = round(value);
  return out;
}

export const classifyTool: ToolDefinition<ClassifyInput, ClassifyOutput> = {
  name: "jev_classify",
  title: "Jev classify",
  promptSnippet:
    "Label many items against your own classes in one call: routing, triage, tagging, grouping.",
  description:
    "Label many items against your own set of classes in one call, using Jev (TypeSafe's System One classifier). " +
    "Each item gets a label, the full probability distribution, confidence, a winner-to-runner-up margin, and a decision: " +
    "auto (safe to act on) or review (look at it yourself). Use it for routing, triage, tagging, and grouping: " +
    "issues, files, log lines, test failures, commits, messages, search results. " +
    "Class descriptions carry the decision, so write precise ones and include a catch-all class such as other. " +
    "Up to 64 items and 250 classes per call; item text is truncated at 4000 characters. Pass raw text, not your guess.",
  guidelines: [
    "Use jev_classify instead of labelling a list by eye when there are more than a handful of items or the labels must be consistent.",
    "In jev_classify, act on decision=auto results and inspect decision=review ones yourself; report both counts to the user.",
    "jev_classify and the other jev_* tools judge the raw evidence you pass (text, diff, log); never pass your own conclusion about it.",
  ],
  schema: classifyInputSchema,
  run: runClassify,
};

/** Exposed for tests: guard against a caller bypassing zod. */
export function assertClasses(classes: Record<string, string | null>): void {
  if (Object.keys(classes).length < 2) {
    throw new JevValidationError("classes needs at least 2 entries.");
  }
}
