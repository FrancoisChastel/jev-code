export interface Rule {
  pattern: RegExp;
  reason: string;
}

export const ALLOWED: RegExp[];
export const FORBIDDEN: Rule[];
export const SECRET_CONTENT: Rule[];

export function checkPackage(
  paths: readonly string[],
  read: (path: string) => string | undefined,
): string[];
