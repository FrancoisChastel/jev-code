/**
 * Remove every trailing `char` from `value`. A loop rather than a `/x+$/` regex, whose
 * backtracking is quadratic on a long run of `char` that is not at the end.
 */
export function trimTrailing(value: string, char: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end -= 1;
  return value.slice(0, end);
}
