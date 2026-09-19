/**
 * Types mirroring the TypeSafe System One API (`POST /v1/systemone`).
 * Kept dependency-free so integrations can import them without pulling in zod.
 * Reference: https://docs.typesafe.ai/primitives
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** State is the content Jev judges: text, or a JSON object/array of text values. */
export type State = string | JsonValue[] | JsonObject;

/** Instructions and criteria accept text or JSON structure; `null` leaves a label undescribed. */
export type Text = string | JsonValue[] | JsonObject | null;

export interface NoulQuestion {
  type: "noul";
  instructions: Text;
  criteria?: { true?: Text; false?: Text } | null;
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: Text;
  /** Option label to description (or `null`). 2 to 255 options. */
  criteria: Record<string, Text>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: Text;
  /** Ordered level descriptions, lowest first. At least 2. */
  criteria: Text[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type QuestionType = Question["type"];
export type Questions = Record<string, Question>;

export interface NoulAnswer {
  type: "noul";
  /** Probability that the answer is yes, 0 to 1. */
  noul: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  /** How peaked the distribution is, 0 to 1. */
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted position; may fall between two levels. */
  score: number;
  legend: Record<string, Text>;
  probabilities?: Record<string, number>;
  confidence: number;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface SystemOneRequest {
  state: State;
  questions: Questions;
  model?: string;
}

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: Usage;
}
