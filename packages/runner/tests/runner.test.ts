import path from "node:path";
import { describe, expect, it } from "vitest";
import { redactSecrets, runCommand } from "../src/index.js";

describe("command runner", () => {
  it("redacts common credentials", () => {
    expect(redactSecrets("api_key=super-secret-value sk-abcdefghijklmnop")).not.toContain(
      "super-secret-value",
    );
  });

  it("records successful execution", async () => {
    const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write('ok')"`;
    const result = await runCommand({
      id: "probe",
      command,
      cwd: path.resolve("."),
      required: true,
      timeoutSeconds: 5,
    });
    expect(result.status).toBe("passed");
    expect(result.stdout).toBe("ok");
  });
});
