import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { readSecret } from "../../src/cli/prompt.js";

function fakeInput(isTTY: boolean) {
  const emitter = new EventEmitter();
  const calls: string[] = [];
  const input = {
    isTTY,
    setRawMode: isTTY
      ? (mode: boolean) => {
          calls.push(`raw:${mode}`);
          return input;
        }
      : undefined,
    setEncoding: () => input,
    resume: () => {
      calls.push("resume");
      return input;
    },
    pause: () => {
      calls.push("pause");
      return input;
    },
    // `never` accepts both listener shapes of SecretInput; the emitter itself is untyped.
    on: (event: string, listener: (payload: never) => void) => {
      emitter.on(event, listener as (...args: unknown[]) => void);
      return input;
    },
    off: (event: string, listener: (payload: never) => void) => {
      emitter.off(event, listener as (...args: unknown[]) => void);
      return input;
    },
  };
  return {
    input,
    calls,
    type: (chunk: string) => emitter.emit("data", chunk),
    fail: (error: Error) => emitter.emit("error", error),
    listeners: () => emitter.listenerCount("data") + emitter.listenerCount("error"),
  };
}

describe("readSecret", () => {
  it("collects typed characters without echoing them, honours backspace, and ends on Enter", async () => {
    const written: string[] = [];
    const { input, calls, type, listeners } = fakeInput(true);
    const pending = readSecret("Key: ", input, {
      write: (text) => {
        written.push(text);
      },
    });
    type("sk-or-ab");
    type("\u007f");
    type("c\r");
    await expect(pending).resolves.toBe("sk-or-ac");
    expect(written.join("")).toBe("Key: \n");
    expect(calls).toEqual(["raw:true", "resume", "raw:false", "pause"]);
    expect(listeners()).toBe(0);
  });

  it("ignores escape sequences and other control characters, keeping what follows them", async () => {
    const { input, type } = fakeInput(false);
    const pending = readSecret("Key: ", input, { write: () => {} });
    type("\u001b[A");
    type("\u001b[Bab\u0001c\n");
    await expect(pending).resolves.toBe("abc");
  });

  it("strips bracketed-paste markers around a pasted key", async () => {
    const { input, type } = fakeInput(true);
    const pending = readSecret("Key: ", input, { write: () => {} });
    type("\u001b[200~sk-or-v1-pasted\u001b[201~\r");
    await expect(pending).resolves.toBe("sk-or-v1-pasted");
  });

  it("rejects and restores the terminal when stdin errors", async () => {
    const { input, calls, fail, listeners } = fakeInput(true);
    const pending = readSecret("Key: ", input, { write: () => {} });
    fail(new Error("EPIPE"));
    await expect(pending).rejects.toThrow("EPIPE");
    expect(calls).toEqual(["raw:true", "resume", "raw:false", "pause"]);
    expect(listeners()).toBe(0);
  });

  it("rejects on Ctrl-C and works without raw mode", async () => {
    const { input, calls, type } = fakeInput(false);
    const pending = readSecret("Key: ", input, { write: () => {} });
    type("\u0003");
    await expect(pending).rejects.toThrow(/cancelled/i);
    expect(calls).toEqual(["resume", "pause"]);
  });
});
