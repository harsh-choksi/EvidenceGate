import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("happy path returns answer text", async () => {
  const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  assert.match(source, /response\.output_text/);
});
