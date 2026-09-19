import { describe, expect, it } from "vitest";
import { realExec, whichBinary } from "../../src/setup/exec.js";

describe("exec helpers", () => {
  it("runs a command and captures output and exit code", async () => {
    const ok = await realExec(process.execPath, [
      "-e",
      "process.stdout.write('hi'); process.stderr.write('warn')",
    ]);
    expect(ok).toEqual({ code: 0, stdout: "hi", stderr: "warn" });
    const failed = await realExec(process.execPath, ["-e", "process.exit(3)"]);
    expect(failed.code).toBe(3);
    const missing = await realExec("/definitely/not/a/binary", []);
    expect(missing.code).toBe(127);
    expect(missing.stderr).toMatch(/ENOENT/);
  });

  it("finds binaries on PATH", () => {
    expect(whichBinary("node")).toMatch(/node/);
    expect(whichBinary("surely-not-installed-xyz")).toBeNull();
    expect(whichBinary("node", { PATH: "" })).toBeNull();
  });
});
