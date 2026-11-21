/**
 * Remove every trailing `char` from `value`. A loop rather than a `/x+$/` regex, whose
 * backtracking is quadratic on a long run of `char` that is not at the end.
 */
export function trimTrailing(value: string, char: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end -= 1;
  return value.slice(0, end);
}

/**
 * Host text bound for the agent's context: control characters and line separators become one
 * space, so a hostile host can neither fake structure nor flood the context past `max`.
 */
export function oneLine(value: string, max: number): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
