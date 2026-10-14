import { describe, expect, test } from "claude-code/testing";
import {
  describeFacts,
  hasUnverifiedEdits,
  isCheck,
  newFacts,
  recordBash,
  recordEdit,
} from "../hooks/facts";

describe("checks", () => {
  test("recognises commands that verify work", async () => {
    for (const command of [
      "npm test",
      "pnpm run lint",
      "bun test",
      "bunx tsc --noEmit",
      "pytest -x tests/",
      "cargo test --all",
      "go vet ./...",
      "claude plugin validate ./up-next",
      "python3 -m pytest",
    ])
      expect(isCheck(command)).toBe(true);
    for (const command of [
      "git status",
      "ls -la",
      "cat package.json",
      "echo hi",
    ])
      expect(isCheck(command)).toBe(false);
  });
});

describe("verification", () => {
  test("edits are unverified until a check that passed runs after the last one", async () => {
    const facts = newFacts();
    expect(hasUnverifiedEdits(facts)).toBe(false);
    recordBash(facts, "npm test", false);
    recordEdit(facts, "/work/src/a.ts");
    expect(hasUnverifiedEdits(facts)).toBe(true);
    recordBash(facts, "npm test", true);
    expect(hasUnverifiedEdits(facts)).toBe(true);
    recordBash(facts, "npm test", false);
    expect(hasUnverifiedEdits(facts)).toBe(false);
    recordEdit(facts, "/work/src/b.ts");
    expect(hasUnverifiedEdits(facts)).toBe(true);
  });

  test("a failing command that is not a check is kept as a failure", async () => {
    const facts = newFacts();
    recordBash(facts, "cat missing.txt", true);
    recordBash(facts, "ls", false);
    expect(facts.failures).toEqual(["cat missing.txt"]);
    expect(facts.checks).toEqual([]);
  });
});

describe("describeFacts", () => {
  test("says nothing when nothing was observed", async () => {
    expect(describeFacts(newFacts())).toBe("");
  });

  test("lists edited files, checks in order, failures and the verdict", async () => {
    const facts = newFacts();
    recordEdit(facts, "/work/src/a.ts");
    recordEdit(facts, "/work/src/a.ts");
    recordEdit(facts, "/work/docs/b.md");
    recordBash(facts, "npm test", true);
    recordBash(facts, "curl localhost:9", true);
    const text = describeFacts(facts);
    expect(text).toContain("Files edited: src/a.ts (2 edits), docs/b.md");
    expect(text).toContain("Checks run, in order: `npm test` failed");
    expect(text).toContain("Commands that failed: `curl localhost:9`");
    expect(text).toContain("No passing check has run since the last edit.");
    recordBash(facts, "npm test", false);
    expect(describeFacts(facts)).toContain(
      "A passing check has run since the last edit.",
    );
  });

  test("shows the first files and counts the rest", async () => {
    const facts = newFacts();
    for (let i = 0; i < 12; i++) recordEdit(facts, `/work/f${i}.ts`);
    expect(describeFacts(facts)).toContain(", and 4 more");
  });
});
