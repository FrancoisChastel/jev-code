/** The parts of `process.stdin` a prompt needs, narrowed so tests can fake them. */
export interface SecretInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "end", listener: () => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
}

export interface SecretOutput {
  write(text: string): unknown;
}

type Outcome = { value: string } | { error: Error };

/**
 * Text that arrived after the line a prompt consumed, kept for the next prompt on the same
 * stream so a paste holding two answers is not cut to one.
 */
const carried = new WeakMap<SecretInput, string>();

function takeCarried(input: SecretInput): string {
  const text = carried.get(input) ?? "";
  carried.delete(input);
  return text;
}

function carry(input: SecretInput, rest: string): void {
  if (rest) carried.set(input, rest);
}

/**
 * Wire one prompt to the stream: feed it anything carried over, then listen until `onData`
 * reports completion, the stream ends, or it fails. Listeners are removed before settling.
 */
function readFrom(
  input: SecretInput,
  consume: (chunk: string) => Outcome | undefined,
  onEnd: () => Outcome,
  settle: (outcome: Outcome) => void,
): void {
  let done = false;
  const finish = (outcome: Outcome): void => {
    done = true;
    input.off("data", onData);
    input.off("end", onStreamEnd);
    input.off("error", onError);
    // The terminal is restored by `settle` before the stream is paused.
    settle(outcome);
    input.pause();
  };
  const onData = (chunk: string): void => {
    const outcome = consume(chunk);
    if (outcome) finish(outcome);
  };
  const onStreamEnd = (): void => finish(onEnd());
  const onError = (error: Error): void => finish({ error });
  input.setEncoding("utf8");
  const pending = takeCarried(input);
  if (pending) onData(pending);
  if (done) return;
  input.on("data", onData);
  input.on("end", onStreamEnd);
  input.on("error", onError);
  input.resume();
}

const NEWLINE = /\r\n|\r|\n/;

/**
 * Ask a visible question and resolve with the line typed, without its newline. The terminal
 * echoes the answer itself, so raw mode is switched off first. End of input counts as Enter.
 */
export function readLine(
  question: string,
  input: SecretInput = process.stdin,
  output: SecretOutput = process.stdout,
): Promise<string> {
  return new Promise((resolve, reject) => {
    output.write(question);
    if (input.isTTY === true && typeof input.setRawMode === "function") input.setRawMode(false);
    let value = "";
    readFrom(
      input,
      (chunk) => {
        value += chunk;
        const match = NEWLINE.exec(value);
        if (!match) return undefined;
        carry(input, value.slice(match.index + match[0].length));
        return { value: value.slice(0, match.index) };
      },
      () => ({ value }),
      (outcome) => ("error" in outcome ? reject(outcome.error) : resolve(outcome.value)),
    );
  });
}

const ENTER = new Set(["\r", "\n"]);
/** Ctrl-C and Ctrl-D. */
const CANCEL = new Set(["\u0003", "\u0004"]);
const BACKSPACE = new Set(["\u007f", "\b"]);
const ESCAPE = "\u001b";
/** Terminal control sequences (CSI): arrow keys, bracketed-paste markers, and the like. */
const CONTROL_SEQUENCE = new RegExp(`${ESCAPE}\\[[0-9;?]*[ -/]*[@-~]`, "g");

/**
 * Ask for a secret without echoing it. Raw mode is used on a terminal so nothing is printed
 * while typing; elsewhere input is read as it arrives. Resolves with the text typed when
 * Enter is pressed; rejects on Ctrl-C, Ctrl-D, or end of input.
 */
export function readSecret(
  question: string,
  input: SecretInput = process.stdin,
  output: SecretOutput = process.stdout,
): Promise<string> {
  return new Promise((resolve, reject) => {
    output.write(question);
    const raw = input.isTTY === true && typeof input.setRawMode === "function";
    if (raw) input.setRawMode?.(true);
    let value = "";
    readFrom(
      input,
      (chunk) => {
        const chars = Array.from(chunk.replace(CONTROL_SEQUENCE, ""));
        for (const [index, char] of chars.entries()) {
          if (ENTER.has(char)) {
            const rest = chars.slice(index + 1).join("");
            // A paste may hold the next answer too; drop only the newline pair's second half.
            carry(input, char === "\r" && rest.startsWith("\n") ? rest.slice(1) : rest);
            return { value };
          }
          if (CANCEL.has(char)) return { error: new Error("Cancelled.") };
          if (BACKSPACE.has(char)) {
            value = value.slice(0, -1);
            continue;
          }
          if (char < " ") continue;
          value += char;
        }
        return undefined;
      },
      () => ({ error: new Error("Cancelled: input ended before Enter.") }),
      (outcome) => {
        if (raw) input.setRawMode?.(false);
        output.write("\n");
        if ("error" in outcome) reject(outcome.error);
        else resolve(outcome.value);
      },
    );
  });
}
