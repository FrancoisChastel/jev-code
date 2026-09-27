/** The parts of `process.stdin` a hidden prompt needs, narrowed so tests can fake them. */
export interface SecretInput {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "data", listener: (chunk: string) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  off(event: "data", listener: (chunk: string) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
}

export interface SecretOutput {
  write(text: string): unknown;
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
 * Enter is pressed; rejects on Ctrl-C or Ctrl-D.
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
    input.setEncoding("utf8");
    input.resume();
    let value = "";
    const finish = (outcome: { value: string } | { error: Error }): void => {
      input.off("data", onData);
      input.off("error", onError);
      if (raw) input.setRawMode?.(false);
      input.pause();
      output.write("\n");
      if ("error" in outcome) reject(outcome.error);
      else resolve(outcome.value);
    };
    const onError = (error: Error): void => finish({ error });
    const onData = (chunk: string): void => {
      for (const char of chunk.replace(CONTROL_SEQUENCE, "")) {
        if (ENTER.has(char)) {
          finish({ value });
          return;
        }
        if (CANCEL.has(char)) {
          finish({ error: new Error("Cancelled.") });
          return;
        }
        if (BACKSPACE.has(char)) {
          value = value.slice(0, -1);
          continue;
        }
        if (char < " ") continue;
        value += char;
      }
    };
    input.on("data", onData);
    input.on("error", onError);
  });
}
