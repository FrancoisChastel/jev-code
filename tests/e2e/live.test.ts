/**
 * Live tests against the real TypeSafe API. Run with:
 *   TYPESAFE_API_KEY=... npm run test:e2e
 * They cost a few hundred tokens and are skipped without a key.
 */
import { describe, expect, it } from "vitest";
import { JevClient } from "../../src/core/client.js";
import { runCheck, runClassify } from "../../src/tools/index.js";

const enabled = process.env.JEV_CODE_E2E === "1" && !!process.env.TYPESAFE_API_KEY;

describe.skipIf(!enabled)("live API", () => {
  const client = () => JevClient.fromEnv(process.env, { userAgent: "jev-code e2e" });

  it("classifies two obvious support messages", async () => {
    const output = await runClassify(client(), {
      instructions: "Route each support message to a team.",
      items: [
        { id: "m1", text: "I was charged twice for my subscription this month." },
        { id: "m2", text: "The API returns 500 on every request since this morning." },
      ],
      classes: {
        billing: "Payments, invoices, refunds, subscription charges",
        technical: "Bugs, outages, integration errors",
        sales: "Pricing questions, plan changes, discounts",
      },
    });
    expect(output.results.find((r) => r.id === "m1")?.label).toBe("billing");
    expect(output.results.find((r) => r.id === "m2")?.label).toBe("technical");
    expect(output.usage?.input_tokens).toBeGreaterThan(0);
  }, 30_000);

  it("answers a yes/no check", async () => {
    const output = await runCheck(client(), {
      state: "pytest: 41 passed, 0 failed, 2 skipped in 3.2s",
      checks: { green: "Does the output report zero failed tests?" },
    });
    expect(output.results[0]?.verdict).toBe("yes");
  }, 30_000);
});
