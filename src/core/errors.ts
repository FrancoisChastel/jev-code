/** Base class for every error raised by jev-code. */
export class JevError extends Error {
  override readonly name: string = "JevError";
}

/** Missing or invalid configuration, such as an absent API key. */
export class JevConfigError extends JevError {
  override readonly name = "JevConfigError";
}

/** The caller supplied an input the tool cannot send (shape, size, duplicates). */
export class JevValidationError extends JevError {
  override readonly name = "JevValidationError";
}

/** The TypeSafe API answered with a non-2xx status. */
export class JevApiError extends JevError {
  override readonly name = "JevApiError";

  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/** The request never reached the API or the connection dropped mid-flight. */
export class JevConnectionError extends JevError {
  override readonly name = "JevConnectionError";
}

/** A single attempt exceeded the configured timeout. */
export class JevTimeoutError extends JevError {
  override readonly name = "JevTimeoutError";
}

/** Narrow an unknown throwable to a printable message. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
