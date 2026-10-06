import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { readLine, readSecret } from "../../src/cli/prompt.js";

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
    end: () => emitter.emit("end"),
    fail: (error: Error) => emitter.emit("error", error),
    listeners: () =>
      emitter.listenerCount("data") + emitter.listenerCount("end") + emitter.listenerCount("error"),
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

describe("readLine", () => {
  it("echoes the question, resolves with the typed line without its newline, and detaches", async () => {
    const { input, calls, type, listeners } = fakeInput(true);
    const out: string[] = [];
    const pending = readLine("Which host? ", input, { write: (t: string) => out.push(t) });
    expect(out).toEqual(["Which host? "]);
    type("2");
    type("\r\n");
    await expect(pending).resolves.toBe("2");
    expect(calls).toEqual(["raw:false", "resume", "pause"]);
    expect(listeners()).toBe(0);
    const { input: second, type: typeSecond } = fakeInput(false);
    const whole = readLine("? ", second, { write: () => undefined });
    typeSecond("openrouter\n");
    await expect(whole).resolves.toBe("openrouter");
  });

  it("treats end of input as Enter, and rejects when the stream fails", async () => {
    const { input, type, end, listeners } = fakeInput(true);
    const pending = readLine("? ", input, { write: () => undefined });
    type("vercel");
    end();
    await expect(pending).resolves.toBe("vercel");
    expect(listeners()).toBe(0);
    const { input: failing, fail } = fakeInput(true);
    const doomed = readLine("? ", failing, { write: () => undefined });
    fail(new Error("stdin closed"));
    await expect(doomed).rejects.toThrow("stdin closed");
  });

  it("carries text after the newline to the next prompt on the same stream", async () => {
    const { input, type, listeners } = fakeInput(true);
    const out: string[] = [];
    const output = { write: (t: string) => out.push(t) };
    const first = readLine("first? ", input, output);
    type("one\r\ntwo\nthree");
    await expect(first).resolves.toBe("one");
    // The second answer is already waiting, so it resolves without touching the stream.
    await expect(readLine("second? ", input, output)).resolves.toBe("two");
    expect(listeners()).toBe(0);
    const third = readLine("third? ", input, output);
    expect(listeners()).toBe(3);
    type("\n");
    await expect(third).resolves.toBe("three");
    expect(out).toEqual(["first? ", "second? ", "third? "]);
  });

  it("hands a secret's trailing paste to the visible prompt that follows", async () => {
    const { input, type } = fakeInput(true);
    const output = { write: () => undefined };
    const secret = readSecret("key? ", input, output);
    type("\u001b[200~apikey_pasted\r\n2\r\u001b[201~");
    await expect(secret).resolves.toBe("apikey_pasted");
    await expect(readLine("host? ", input, output)).resolves.toBe("2");
    const { input: ended, type: typeEnded, end } = fakeInput(false);
    const cut = readSecret("key? ", ended, output);
    typeEnded("half");
    end();
    await expect(cut).rejects.toThrow("input ended before Enter");
  });
});

it("collects custom text fields followed by a secret without echoing the secret", async () => {
  const { input, type, calls, listeners } = fakeInput(true);
  const written: string[] = [];
  const output = { write: (text: string) => written.push(text) };
  const name = readLine("Provider name: ", input, output);
  type("Gateway\nhttps://gateway.example\nVendor/Jev\nopaque-secret\n");
  await expect(name).resolves.toBe("Gateway");
  await expect(readLine("Base URL: ", input, output)).resolves.toBe("https://gateway.example");
  await expect(readLine("Model: ", input, output)).resolves.toBe("Vendor/Jev");
  await expect(readSecret("API key (hidden): ", input, output)).resolves.toBe("opaque-secret");
  expect(written.join("")).not.toContain("opaque-secret");
  expect(calls).toContain("raw:true");
  expect(listeners()).toBe(0);
});
