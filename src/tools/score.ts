import type { JevClient, RequestOptions } from "../core/client.js";
import type { Questions, ScoreQuestion, Usage } from "../core/types.js";
import { roundAll } from "./classify.js";
import {
  assertRequestBudget,
  buildState,
  contextValue,
  itemsToState,
  prepareItems,
  round,
} from "./common.js";
import { parseInput, type ToolDefinition } from "./definition.js";
import { confidenceDecision, type Decision } from "./policy.js";
import { type ScoreInput, scoreInputSchema } from "./schemas.js";

export const SCORE_DEFAULTS = { autoAccept: 0.7 } as const;

export interface ScoreResult {
  id: string;
  /** Probability-weighted position, from 0 to levels.length - 1; may fall between levels. */
  score: number;
  /** Index of the nearest level. */
  level: number;
  /** Text of the nearest level. */
  label: string;
  confidence: number;
  decision: Decision;
  probabilities?: Record<string, number>;
  truncated?: true;
  status?: "invalid_response";
}

export interface ScoreOutput {
  summary: {
    items: number;
    auto: number;
    review: number;
    mean_score: number;
    by_level: Record<string, number>;
  };
  legend: Record<string, string>;
  results: ScoreResult[];
  thresholds: { auto_accept: number };
  model: string;
  usage?: Usage;
}

export async function runScore(
  client: JevClient,
  rawInput: unknown,
  options: RequestOptions = {},
): Promise<ScoreOutput> {
  const input = parseInput(scoreInputSchema, rawInput, "jev_score");
  const autoAccept = input.auto_accept ?? SCORE_DEFAULTS.autoAccept;
  const items = prepareItems(input.items);
  const questions: Questions = {};
  for (const item of items) {
    const question: ScoreQuestion = {
      type: "score",
      instructions: `${input.instructions.trim()} Rate \`items.${item.key}\` on its own; other items are unrelated.`,
      criteria: input.levels,
    };
    questions[item.key] = question;
  }
  const request = {
    state: buildState({ context: contextValue(input.context), items: itemsToState(items) }),
    questions,
  };
  assertRequestBudget(request);

  const response = await client.systemOne(request, options);
  const legend: Record<string, string> = {};
  input.levels.forEach((level, index) => {
    legend[String(index)] = level;
  });
  const byLevel: Record<string, number> = {};
  let auto = 0;
  let total = 0;
  let scored = 0;
  const results: ScoreResult[] = items.map((item) => {
    const answer = response.answers[item.key];
    if (answer?.type !== "score" || typeof answer.score !== "number") {
      return {
        id: item.id,
        score: 0,
        level: 0,
        label: input.levels[0] ?? "",
        confidence: 0,
        decision: "review",
        status: "invalid_response",
        ...(item.truncated ? { truncated: true as const } : {}),
      };
    }
    const level = Math.min(input.levels.length - 1, Math.max(0, Math.round(answer.score)));
    const decision = confidenceDecision(answer.confidence, autoAccept);
    if (decision === "auto") auto += 1;
    byLevel[String(level)] = (byLevel[String(level)] ?? 0) + 1;
    total += answer.score;
    scored += 1;
    return {
      id: item.id,
      score: round(answer.score),
      level,
      label: input.levels[level] ?? "",
      confidence: round(answer.confidence),
      decision,
      ...(answer.probabilities ? { probabilities: roundAll(answer.probabilities) } : {}),
      ...(item.truncated ? { truncated: true as const } : {}),
    };
  });

  return {
    summary: {
      items: results.length,
      auto,
      review: results.length - auto,
      mean_score: scored ? round(total / scored) : 0,
      by_level: byLevel,
    },
    legend,
    results,
    thresholds: { auto_accept: autoAccept },
    model: response.model,
    ...(response.usage ? { usage: response.usage } : {}),
  };
}

export const scoreTool: ToolDefinition<ScoreInput, ScoreOutput> = {
  name: "jev_score",
  title: "Jev score",
  promptSnippet:
    "Rate many items on one ordered scale you define: severity, priority, quality, risk.",
  description:
    "Rate many items on one ordered scale you define, in one call, using Jev. " +
    "Each item gets a score (a position on your levels that may fall between two of them), the nearest level, " +
    "confidence, and an auto/review decision. Use it for severity triage, prioritisation, quality grading, and risk rating " +
    "of bug reports, test failures, TODOs, findings, or candidates. Levels must describe concrete situations from low to high; " +
    "a score is a position on that spectrum, not a probability. Up to 64 items and 20 levels per call.",
  guidelines: [
    "Use jev_score when items need a consistent severity or priority ordering rather than a category; use jev_classify for categories.",
  ],
  schema: scoreInputSchema,
  run: runScore,
};
