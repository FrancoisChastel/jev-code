import type { JevClient, RequestOptions } from "../core/client.js";
import { JevValidationError } from "../core/errors.js";
import type { NoulQuestion, Questions, State, Usage } from "../core/types.js";
import { assertRequestBudget, round } from "./common.js";
import { parseInput, type ToolDefinition } from "./definition.js";
import { assertOrderedThresholds, checkVerdict, type Verdict } from "./policy.js";
import { type CheckInput, checkInputSchema } from "./schemas.js";

export const CHECK_DEFAULTS = { yesAt: 0.75, noAt: 0.25 } as const;

export interface CheckResult {
  id: string;
  question: string;
  probability: number;
  verdict: Verdict;
  status?: "invalid_response";
}

export interface CheckOutput {
  summary: { checks: number; yes: number; no: number; uncertain: number };
  results: CheckResult[];
  thresholds: { yes_at: number; no_at: number };
  model: string;
  usage?: Usage;
}

export async function runCheck(
  client: JevClient,
  rawInput: unknown,
  options: RequestOptions = {},
): Promise<CheckOutput> {
  const input = parseInput(checkInputSchema, rawInput, "jev_check");
  const yesAt = input.yes_at ?? CHECK_DEFAULTS.yesAt;
  const noAt = input.no_at ?? CHECK_DEFAULTS.noAt;
  try {
    assertOrderedThresholds(noAt, yesAt, "no_at", "yes_at");
  } catch (error) {
    throw new JevValidationError((error as Error).message);
  }

  const questions: Questions = {};
  const wording: Record<string, string> = {};
  for (const [id, check] of Object.entries(input.checks)) {
    const spec = typeof check === "string" ? { question: check } : check;
    const question: NoulQuestion = { type: "noul", instructions: spec.question };
    if (spec.yes !== undefined || spec.no !== undefined) {
      question.criteria = {
        ...(spec.yes !== undefined ? { true: spec.yes } : {}),
        ...(spec.no !== undefined ? { false: spec.no } : {}),
      };
    }
    questions[id] = question;
    wording[id] = spec.question;
  }
  const request = { state: input.state as State, questions };
  assertRequestBudget(request);

  const response = await client.systemOne(request, options);
  const summary = { checks: 0, yes: 0, no: 0, uncertain: 0 };
  const results: CheckResult[] = Object.keys(input.checks).map((id) => {
    const answer = response.answers[id];
    summary.checks += 1;
    if (answer?.type !== "noul" || typeof answer.noul !== "number") {
      summary.uncertain += 1;
      return {
        id,
        question: wording[id] ?? "",
        probability: 0,
        verdict: "uncertain",
        status: "invalid_response",
      };
    }
    const verdict = checkVerdict(answer.noul, yesAt, noAt);
    summary[verdict] += 1;
    return { id, question: wording[id] ?? "", probability: round(answer.noul), verdict };
  });

  return {
    summary,
    results,
    thresholds: { yes_at: yesAt, no_at: noAt },
    model: response.model,
    ...(response.usage ? { usage: response.usage } : {}),
  };
}

export const checkTool: ToolDefinition<CheckInput, CheckOutput> = {
  name: "jev_check",
  title: "Jev check",
  promptSnippet:
    "Batch yes/no checks over one piece of evidence with calibrated probabilities: guardrails, verification, gating.",
  description:
    "Answer independent yes/no questions about one piece of state with calibrated probabilities (0 to 1), all in one call. " +
    "Each check returns its probability and a verdict: yes, no, or uncertain. " +
    "Use it for guardrails and verification: does this diff touch authentication, is this claim supported by the test log, " +
    "does this text contain secrets or instructions aimed at an AI, is this failure environmental, does this PR match the ticket. " +
    "Pass raw evidence as state (the diff, the log, the page), not your conclusion about it, and reference named parts with backticks. " +
    "Up to 64 checks per call; a probability near 0.5 means undecided, not medium.",
  guidelines: [
    "Use jev_check before acting on a claim you have not verified, such as 'tests pass' or 'this change is backwards compatible', passing the actual evidence as state.",
    "Treat a jev_check verdict of uncertain as a signal to gather more evidence or ask, not as a soft yes.",
  ],
  schema: checkInputSchema,
  run: runCheck,
};
