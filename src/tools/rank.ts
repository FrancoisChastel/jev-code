import type { JevClient, RequestOptions } from "../core/client.js";
import type { NoulQuestion, Questions, Usage } from "../core/types.js";
import {
  assertRequestBudget,
  buildState,
  contextValue,
  itemsToState,
  prepareItems,
  round,
} from "./common.js";
import { parseInput, type ToolDefinition } from "./definition.js";
import { type RankInput, rankInputSchema } from "./schemas.js";

export const RANK_DEFAULTS = { relevantAt: 0.5 } as const;
const ANY_KEY = "__any_relevant";

export interface RankResult {
  rank: number;
  id: string;
  relevance: number;
  relevant: boolean;
  truncated?: true;
  status?: "invalid_response";
}

export interface RankOutput {
  /** Probability that at least one candidate answers the query at all. */
  any_relevant: number;
  summary: { candidates: number; relevant: number; returned: number };
  ranked: RankResult[];
  thresholds: { relevant_at: number };
  model: string;
  usage?: Usage;
}

export async function runRank(
  client: JevClient,
  rawInput: unknown,
  options: RequestOptions = {},
): Promise<RankOutput> {
  const input = parseInput(rankInputSchema, rawInput, "jev_rank");
  const relevantAt = input.relevant_at ?? RANK_DEFAULTS.relevantAt;
  const candidates = prepareItems(input.candidates, "candidate");
  const questions: Questions = {};
  for (const candidate of candidates) {
    const question: NoulQuestion = {
      type: "noul",
      instructions: `Does \`candidates.${candidate.key}\` answer or directly help with \`query\`? Judge this candidate on its own.`,
      criteria: {
        true: "The candidate contains what the query asks for, or is the place to look for it",
        false: "The candidate is about something else or only shares surface words with the query",
      },
    };
    questions[candidate.key] = question;
  }
  questions[ANY_KEY] = {
    type: "noul",
    instructions: "Does at least one entry in `candidates` answer or directly help with `query`?",
  };
  const request = {
    state: buildState({
      query: input.query,
      context: contextValue(input.context),
      candidates: itemsToState(candidates),
    }),
    questions,
  };
  assertRequestBudget(request);

  const response = await client.systemOne(request, options);
  const anyAnswer = response.answers[ANY_KEY];
  const anyRelevant =
    anyAnswer && anyAnswer.type === "noul" && typeof anyAnswer.noul === "number"
      ? round(anyAnswer.noul)
      : 0;
  const scored = candidates.map((candidate, index) => {
    const answer = response.answers[candidate.key];
    const valid = answer && answer.type === "noul" && typeof answer.noul === "number";
    return {
      index,
      id: candidate.id,
      relevance: valid ? answer.noul : 0,
      invalid: !valid,
      truncated: candidate.truncated,
    };
  });
  scored.sort((a, b) => b.relevance - a.relevance || a.index - b.index);
  const relevantCount = scored.filter(
    (entry) => !entry.invalid && entry.relevance >= relevantAt,
  ).length;
  const limited = input.top_k ? scored.slice(0, input.top_k) : scored;
  const ranked: RankResult[] = limited.map((entry, position) => ({
    rank: position + 1,
    id: entry.id,
    relevance: round(entry.relevance),
    relevant: !entry.invalid && entry.relevance >= relevantAt,
    ...(entry.truncated ? { truncated: true as const } : {}),
    ...(entry.invalid ? { status: "invalid_response" as const } : {}),
  }));

  return {
    any_relevant: anyRelevant,
    summary: { candidates: candidates.length, relevant: relevantCount, returned: ranked.length },
    ranked,
    thresholds: { relevant_at: relevantAt },
    model: response.model,
    ...(response.usage ? { usage: response.usage } : {}),
  };
}

export const rankTool: ToolDefinition<RankInput, RankOutput> = {
  name: "jev_rank",
  title: "Jev rank",
  promptSnippet:
    "Rank candidates (files, docs, symbols, hits) by relevance to a plain-language query, no embeddings needed.",
  description:
    "Rank candidates by relevance to a plain-language query using Jev; no embeddings or index required. " +
    "Each candidate gets an independent relevance probability and the list comes back sorted, together with " +
    "any_relevant: the probability that any candidate answers the query at all, so a top hit is not mistaken for an answer. " +
    "Use it to pick which files, functions, docs, tickets, or search hits to open for a question, or to order a long list by meaning. " +
    "Up to 250 candidates per call; use file paths or symbol names as ids and an excerpt as text.",
  guidelines: [
    "Use jev_rank to choose which of many candidate files or documents to read when grep or names alone are not conclusive; check any_relevant before trusting the top hit.",
  ],
  schema: rankInputSchema,
  run: runRank,
};
