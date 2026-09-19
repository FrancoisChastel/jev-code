import { JevValidationError } from "../core/errors.js";
import { LIMITS, TRUNCATION_MARKER } from "../core/limits.js";
import type { JsonObject, JsonValue, State, SystemOneRequest, Text } from "../core/types.js";

export interface Item {
  id: string;
  text: string;
}

export interface PreparedItem {
  /** The caller's id, echoed back verbatim. */
  id: string;
  /** The key used inside state and questions; safe for the API and for dotted paths. */
  key: string;
  text: string;
  truncated: boolean;
}

/** Keep letters, digits, underscore, dash and dot; everything else collapses to underscore. */
export function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.slice(0, LIMITS.idChars);
}

export function truncate(text: string, maxChars: number = LIMITS.itemChars): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + TRUNCATION_MARKER;
}

/**
 * Assign each item a safe, unique key. Duplicate ids (before or after sanitising)
 * are an error rather than a silent rename, so results always map back cleanly.
 */
export function prepareItems(items: readonly Item[], label = "item"): PreparedItem[] {
  const seenIds = new Set<string>();
  const seenKeys = new Map<string, string>();
  return items.map((item, index) => {
    if (seenIds.has(item.id)) {
      throw new JevValidationError(`Duplicate ${label} id "${item.id}". Ids must be unique.`);
    }
    seenIds.add(item.id);
    const key = sanitizeId(item.id) || `${label}_${index + 1}`;
    const clash = seenKeys.get(key);
    if (clash !== undefined) {
      throw new JevValidationError(
        `${label} ids "${clash}" and "${item.id}" collide after sanitising to "${key}". Use ids that differ in letters, digits, dots, dashes or underscores.`,
      );
    }
    seenKeys.set(key, item.id);
    const text = truncate(item.text);
    return { id: item.id, key, text, truncated: text !== item.text };
  });
}

/** Build the `items` map placed in state, keyed by safe key. */
export function itemsToState(items: readonly PreparedItem[]): JsonObject {
  const out: JsonObject = {};
  for (const item of items) out[item.key] = item.text;
  return out;
}

/** Normalise optional shared context into something JSON-serialisable, or omit it. */
export function contextValue(context: unknown): JsonValue | undefined {
  if (context === undefined || context === null || context === "") return undefined;
  return context as JsonValue;
}

/** Assemble state as an object when there are named parts, keeping the shape predictable. */
export function buildState(parts: Record<string, JsonValue | undefined>): State {
  const state: JsonObject = {};
  for (const [name, value] of Object.entries(parts)) {
    if (value !== undefined) state[name] = value;
  }
  return state;
}

/** Reject requests that would exceed the model's context before spending a call. */
export function assertRequestBudget(request: SystemOneRequest): void {
  const size = JSON.stringify(request).length;
  if (size > LIMITS.requestChars) {
    throw new JevValidationError(
      `Request is ${size.toLocaleString()} characters, above the ${LIMITS.requestChars.toLocaleString()} character budget. Split the items into smaller batches or shorten the texts.`,
    );
  }
}

/** Round to 3 decimals so JSON output stays readable. */
export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Text helper for question wording. */
export function asText(value: Text): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
