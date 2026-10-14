import { describe, expect, test } from "claude-code/testing";
import {
  advisorPrompt,
  clean,
  hasPlaceholder,
  isRisky,
  labelOf,
  namesKnownCommand,
  normalize,
  parseAdvice,
  skillList,
  splitCommand,
} from "../hooks/advice";

const COMMANDS = [
  { name: "clear", description: "Clear the conversation", source: "builtin" },
  {
    name: "code-review",
    description: "Review the changes on this branch",
    source: "plugin",
    plugin: "code-review",
  },
  {
    name: "deploy-checklist",
    description: "Pre-deploy checks\u0007",
    source: "user",
  },
];
const KNOWN = new Set(COMMANDS.map((c) => c.name));
const ANY = { known: null, skipped: [] as string[] };

describe("parseAdvice", () => {
  test("takes the step, its kind and its reason out of a JSON reply", async () => {
    const reply =
      'Sure. {"kind":"verify","prompt":"run the tests you just wrote","why":"the change is unverified"}';
    expect(parseAdvice(reply, ANY)).toEqual({
      ok: true,
      step: {
        kind: "verify",
        prompt: "run the tests you just wrote",
        why: "the change is unverified",
      },
    });
  });

  test("defaults the kind, and takes the first entry of an older list reply", async () => {
    expect(parseAdvice('{"prompt":"show me the diff"}', ANY)).toEqual({
      ok: true,
      step: { kind: "advance", prompt: "show me the diff", why: "" },
    });
    expect(
      parseAdvice(
        '{"steps":[{"prompt":"show me the diff","kind":"verify"},{"prompt":"other"}]}',
        ANY,
      ),
    ).toEqual({
      ok: true,
      step: { kind: "verify", prompt: "show me the diff", why: "" },
    });
  });

  test("says why there is no advice", async () => {
    expect(parseAdvice('{"prompt":"","why":"done"}', ANY)).toEqual({
      ok: false,
      reason: "nothing worth suggesting",
    });
    expect(parseAdvice('{"steps":[]}', ANY)).toEqual({
      ok: false,
      reason: "nothing worth suggesting",
    });
    expect(parseAdvice("run the tests", ANY)).toEqual({
      ok: false,
      reason: "no JSON in the reply",
    });
  });

  test("drops a step with a placeholder left to fill in", async () => {
    expect(
      parseAdvice(
        '{"prompt":"I pressed Run. Here is what I saw: [paste]. Fix it"}',
        ANY,
      ),
    ).toEqual({ ok: false, reason: "step has a placeholder" });
  });

  test("drops irreversible or outward-facing steps", async () => {
    expect(parseAdvice('{"prompt":"merge the PR"}', ANY)).toEqual({
      ok: false,
      reason: "risky step filtered",
    });
  });

  test("keeps a known slash command and drops an invented one", async () => {
    const known = { ...ANY, known: KNOWN };
    expect(
      parseAdvice('{"prompt":"/code-review high","why":"unreviewed"}', known),
    ).toEqual({
      ok: true,
      step: { kind: "advance", prompt: "/code-review high", why: "unreviewed" },
    });
    expect(parseAdvice('{"prompt":"/made-up thing"}', known)).toEqual({
      ok: false,
      reason: "unknown slash command",
    });
  });

  test("does not offer what was skipped, however it is spelled", async () => {
    expect(
      parseAdvice('{"prompt":"run the tests"}', {
        ...ANY,
        skipped: ["Run the tests!"],
      }),
    ).toEqual({ ok: false, reason: "already skipped" });
  });
});

describe("placeholders", () => {
  test("catches stand-ins left for the user to fill in", async () => {
    for (const prompt of [
      "Here's what I saw: [paste]. Fix it",
      "[Describe what happened] and fix it",
      "open <file> and check the import",
      "rename it to {{name}}",
      "compare it with (<expected output>)",
    ])
      expect(hasPlaceholder(prompt)).toBe(true);
  });

  test("leaves code and ordinary text alone", async () => {
    for (const prompt of [
      "run the tests you just wrote",
      "fix the off-by-one in arr[i] in parse.ts",
      "type the cache as Map<string, number>",
      "show me the diff for <Button> in card.tsx",
      "/code-review high",
    ])
      expect(hasPlaceholder(prompt)).toBe(false);
  });
});

describe("text handling", () => {
  test("strips escape sequences and control characters, refuses tag characters", async () => {
    expect(clean("run\u001b[31m the\u0007 tests", 100)).toBe("run the tests");
    expect(clean("hidden\u{E0041}", 100)).toBe("");
    expect(clean("abcdef", 4)).toBe("abc…");
    expect(clean("a\n\n  b\tc", 100)).toBe("a b c");
  });

  test("flags risky wording and leaves ordinary steps alone", async () => {
    for (const risky of [
      "push the branch",
      "force-push it",
      "deploy to staging",
      "delete the old logs",
      "rm -rf build",
      "git reset --hard",
      "send the summary to the team",
    ])
      expect(isRisky(risky)).toBe(true);
    for (const fine of [
      "run the tests you just wrote",
      "show me the diff",
      "/code-review high",
      "check the error handling in parse.ts",
    ])
      expect(isRisky(fine)).toBe(false);
  });

  test("splits a slash step and checks the command exists", async () => {
    expect(splitCommand("/code-review high")).toEqual({
      command: "code-review",
      args: "high",
    });
    expect(splitCommand("/compact")).toEqual({ command: "compact", args: "" });
    expect(splitCommand("run the tests")).toBeNull();
    expect(namesKnownCommand("/made-up", null)).toBe(true);
    expect(namesKnownCommand("/made-up", KNOWN)).toBe(false);
    expect(namesKnownCommand("run the tests", KNOWN)).toBe(true);
  });

  test("treats spelling, case and punctuation as the same step", async () => {
    expect(normalize("Run the tests!")).toBe(normalize("run   the tests"));
  });

  test("labels a step by its kind, or as a skill when it is a slash command", async () => {
    const base = { why: "", prompt: "x" };
    expect(labelOf({ ...base, kind: "verify" })).toBe("VERIFY");
    expect(labelOf({ ...base, kind: "unblock" })).toBe("UNBLOCK");
    expect(labelOf({ ...base, kind: "advance" })).toBe("ADVANCE");
    expect(labelOf({ ...base, prompt: "/code-review", kind: "verify" })).toBe(
      "SKILL",
    );
  });
});

describe("skills", () => {
  test("lists plugin and user commands with cleaned descriptions, not engine ones", async () => {
    const list = skillList(COMMANDS as any);
    expect(list).toContain("/code-review: Review the changes on this branch");
    expect(list).toContain("/deploy-checklist: Pre-deploy checks");
    expect(list).not.toContain("/clear");
    expect(list).not.toContain("\u0007");
  });

  test("past the budget, commands are listed by name alone", async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      name: `cmd-${i}`,
      description: "d".repeat(110),
      source: "plugin",
    }));
    const last = skillList(many as any)
      .split("\n")
      .at(-1)!;
    expect(last.startsWith("/cmd-")).toBe(true);
    expect(last).not.toContain(":");
  });
});

describe("advisorPrompt", () => {
  const parts = { skills: "", facts: "", skipped: [] as string[] };

  test("asks for one step as JSON, sendable as written, with the safety rules", async () => {
    const prompt = advisorPrompt(parts);
    expect(prompt).toContain("Do not continue the task");
    expect(prompt).toContain("the single message most worth sending you next");
    expect(prompt).toContain("Never recommend irreversible or outward-facing");
    expect(prompt).toContain("can be sent exactly as written");
    expect(prompt).toContain("no placeholders");
    expect(prompt).toContain('{"kind":"verify|unblock|advance","prompt":');
    expect(prompt).not.toContain('"steps"');
  });

  test("asks for nothing when the best next move is one only the user can make", async () => {
    expect(advisorPrompt(parts)).toContain(
      "If the most valuable next move is one only the user can make",
    );
    expect(advisorPrompt(parts)).toContain("return an empty prompt");
  });

  test("carries the observed facts, the skipped steps and the skills only when there are some", async () => {
    expect(advisorPrompt(parts)).not.toContain("<observed>");
    expect(advisorPrompt(parts)).not.toContain("already skipped");
    expect(advisorPrompt(parts)).not.toContain("available-skills");
    const full = advisorPrompt({
      skills: "/code-review: Review",
      facts: "Files edited: a.ts",
      skipped: ["show me the diff"],
    });
    expect(full).toContain("<observed>\nFiles edited: a.ts\n</observed>");
    expect(full).toContain("- show me the diff");
    expect(full).toContain(
      "<available-skills>\n/code-review: Review\n</available-skills>",
    );
  });
});
