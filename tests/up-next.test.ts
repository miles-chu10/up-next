import { describe, expect, test } from "claude-code/testing";

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};
const LONG =
  "Here is a long enough answer that the advisor should run after it finishes. ".repeat(
    2,
  );
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
};
const COMMANDS = [
  { name: "clear", description: "Clear the conversation", source: "builtin" },
  {
    name: "code-review",
    description: "Review the changes on this branch",
    source: "plugin",
    plugin: "code-review",
  },
];
const STEP_TESTS = {
  kind: "verify",
  prompt: "run the tests you just wrote",
  why: "the change is unverified",
};
const STEP_REVIEW = {
  kind: "unblock",
  prompt: "/code-review high",
  why: "the diff has not been reviewed",
};
// The advisor answers with one step, or an empty prompt for none.
const reply = (step: object = { prompt: "", why: "" }) => JSON.stringify(step);
const ONE = reply(STEP_TESTS);

declare function setTimeout(run: (...args: any[]) => void, ms: number): unknown;

// A tool call by name: the typed form is slow to check where many MCP servers
// are connected.
const call = ($: any, input: object) => $.tool.call(input);

// The advice is fetched detached from turn.complete, so let it land.
const settle = () => new Promise((r) => setTimeout(r, 50));

function answer(turnId: string, extra: Record<string, unknown> = {}) {
  return {
    reason: "answer",
    answer: LONG,
    turnId,
    isAborted: false,
    durationMs: 1,
    ...extra,
  } as any;
}

type HostOptions = {
  // Stands for the mods after this one in the band (another mod's row).
  beneath?: ($: any, e: any) => unknown;
  // Holds the advice back until the test releases it.
  gate?: Promise<void>;
  // The message box's text; a surface with no box takes no fill.
  box?: string;
  composer?: boolean | "blind";
  surfaces?: string[];
  // A prompt.submit hook's refusal.
  drop?: string;
  // How tool calls beneath the mod answer.
  tools?: (e: any) => unknown;
};

function host(on: any, replies: string | string[], opts: HostOptions = {}) {
  const forkPrompts: string[] = [];
  const suggested: string[] = [];
  const statuses: (string | undefined)[] = [];
  const submitted: { text: string; origin: any }[] = [];
  const commands: { command: string; args: string }[] = [];
  const filled: string[] = [];
  const copied: string[] = [];
  const toasts: string[] = [];
  const registered: string[] = [];
  let box = opts.box ?? "";
  let n = 0;
  const list = Array.isArray(replies) ? replies : [replies];

  on("model.fork", async ($: unknown, e: { prompt: string }) => {
    forkPrompts.push(e.prompt);
    if (opts.gate) await opts.gate;
    const text = list[Math.min(n++, list.length - 1)]!;
    return { value: { isAnswered: true, text, usage: USAGE } };
  });
  on("command.list", () => ({ value: COMMANDS }));
  on("command.register", ($: unknown, e: { name: string }) => {
    registered.push(e.name);
    return { value: { command: e.name } };
  });
  on("command.run", ($: unknown, e: { command: string; args: string }) => {
    commands.push({ command: e.command, args: e.args });
    return { text: "" };
  });
  on("session.start", ($: unknown, e: { cwd: string }) => ({ cwd: e.cwd }));
  on("session.surfaces", () => ({ value: opts.surfaces ?? ["desktop"] }));
  on("prompt.suggest", ($: unknown, e: { text: string }) => {
    suggested.push(e.text);
    return { isShown: true };
  });
  on("prompt.submit", ($: unknown, e: { text: string; origin: unknown }) => {
    submitted.push({ text: e.text, origin: e.origin });
    return opts.drop === undefined ? { text: e.text } : { drop: opts.drop };
  });
  on("prompt.read", () => ({ value: { text: box, cursor: box.length } }));
  on("prompt.fill", ($: unknown, e: { text: string }) => {
    if (opts.composer === false) return { isFilled: false };
    // A box that takes the text but reports none back (nobody can see it).
    if (opts.composer === "blind")
      return { isFilled: true, text: "", cursor: 0 };
    box = e.text;
    filled.push(e.text);
    return { isFilled: true, text: box, cursor: box.length };
  });
  on("tool.call", ($: unknown, e: unknown) =>
    opts.tools ? opts.tools(e) : { result: { ok: true } },
  );
  on("ui.status", ($: unknown, e: { text?: string }) => {
    statuses.push(e.text);
    return { value: undefined };
  });
  on("ui.copy", ($: unknown, e: { text: string }) => {
    copied.push(e.text);
    return { value: { isCopied: true } };
  });
  on("ui.toast", ($: unknown, e: { text: string }) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.log", () => ({ value: undefined }));
  on(
    "ui.render",
    opts.beneath ?? (($: any, e: any) => $.ui.resolve(e).Box({})),
  );
  on("turn.start", ($: unknown, e: { turnId: string }) => ({
    turnId: e.turnId,
  }));
  on("turn.complete", () => ({ text: "" }));
  return {
    forkPrompts,
    suggested,
    statuses,
    submitted,
    commands,
    filled,
    copied,
    toasts,
    registered,
    forks: () => forkPrompts.length,
    box: () => box,
  };
}

async function mount(
  $: any,
  surface: string,
  component = "AbovePrompt",
  extra = {},
) {
  return $.ui.mount({
    plugin: "up-next",
    surface,
    component,
    props: component === "AbovePrompt" ? BAND : {},
    ...extra,
  } as any);
}

const hasText = async (ui: any, text: RegExp) =>
  (await ui.find({ type: "Text", text })) !== undefined;

describe("after a turn", () => {
  test("offers the one best step with its reason, ghost text and status", async ($, on) => {
    const h = host(on, ONE);
    await $.turn.start({ turnId: "t1" } as any);
    await $.turn.complete(answer("t1"));
    await settle();
    expect(h.forks()).toBe(1);
    expect(h.forkPrompts[0]).toContain("the single message most worth sending");
    expect(h.forkPrompts[0]).toContain(
      "/code-review: Review the changes on this branch",
    );
    expect(h.suggested).toEqual(["run the tests you just wrote"]);
    expect(h.statuses).toContain("next: the change is unverified");
  });

  test("drops the engine's own guess at the next prompt", async ($, on) => {
    const h = host(on, "{}");
    const mine = await $.prompt.suggest({ text: "a guess" } as any);
    const engine = await ($ as any).prompt.suggest({
      text: "engine guess",
      origin: { kind: "suggestion" },
    });
    expect(mine.isShown).toBe(true);
    expect(engine.isShown).toBe(false);
    expect(h.suggested).toEqual(["a guess"]);
  });

  test("skips subagent turns, short answers and interrupted turns", async ($, on) => {
    const h = host(on, ONE);
    await $.turn.complete(answer("s1", { agentId: "a1" }));
    await $.turn.complete(answer("t2", { answer: "short" }));
    await $.turn.complete(answer("t3", { reason: "aborted", isAborted: true }));
    await settle();
    expect(h.forks()).toBe(0);
    expect(h.suggested).toEqual([]);
  });

  test("offers nothing for a risky step or an invented slash command", async ($, on) => {
    const risky = host(on, reply({ prompt: "merge the PR", why: "ready" }));
    await $.turn.complete(answer("t4"));
    await settle();
    expect(risky.forks()).toBe(1);
    expect(risky.suggested).toEqual([]);
  });

  test("a step with a placeholder to fill in is not offered", async ($, on) => {
    const h = host(
      on,
      reply({
        kind: "verify",
        prompt: "I pressed Run. Here's what I saw: [paste]. Fix anything off",
        why: "the card is untested",
      }),
    );
    await $.turn.complete(answer("t6"));
    await settle();
    expect(h.forks()).toBe(1);
    expect(h.suggested).toEqual([]);
  });

  test("an invented slash command is not offered", async ($, on) => {
    const h = host(on, reply({ prompt: "/ship-it now", why: "done" }));
    await $.turn.complete(answer("t5"));
    await settle();
    expect(h.suggested).toEqual([]);
  });
});

describe("grounding", () => {
  test("tells the advisor what the turn edited and whether a check passed since", async ($, on) => {
    const h = host(on, ONE);
    await $.turn.start({ turnId: "g1" } as any);
    await call($, { tool: "Edit", file_path: "/work/src/a.ts" });
    await call($, { tool: "Write", file_path: "/work/docs/b.md" });
    await $.turn.complete(answer("g1"));
    await settle();
    expect(h.forkPrompts[0]).toContain("Files edited: src/a.ts, docs/b.md");
    expect(h.forkPrompts[0]).toContain(
      "No passing check has run since the last edit.",
    );

    await $.turn.start({ turnId: "g2" } as any);
    await call($, { tool: "Edit", file_path: "/work/src/a.ts" });
    await call($, { tool: "Bash", command: "npm test" });
    await $.turn.complete(answer("g2"));
    await settle();
    expect(h.forkPrompts[1]).toContain("`npm test` passed");
    expect(h.forkPrompts[1]).toContain(
      "A passing check has run since the last edit.",
    );
  });

  test("a failing check or a refused edit counts as it happened", async ($, on) => {
    const h = host(on, ONE, {
      tools: (e: any) =>
        e.command === "npm test"
          ? { isError: true, result: "1 failed", text: "1 failed" }
          : e.file_path === "/work/blocked.ts"
            ? { deny: "no" }
            : { result: { ok: true } },
    });
    await $.turn.start({ turnId: "g3" } as any);
    await call($, { tool: "Edit", file_path: "/work/src/a.ts" });
    await call($, { tool: "Edit", file_path: "/work/blocked.ts" });
    await call($, { tool: "Bash", command: "npm test" });
    await $.turn.complete(answer("g3"));
    await settle();
    expect(h.forkPrompts[0]).toContain("`npm test` failed");
    expect(h.forkPrompts[0]).toContain("Files edited: src/a.ts\n");
    expect(h.forkPrompts[0]).not.toContain("blocked.ts");
    expect(h.forkPrompts[0]).toContain(
      "No passing check has run since the last edit.",
    );
  });

  test("a subagent starting mid-turn does not wipe what the main turn did", async ($, on) => {
    const h = host(on, ONE);
    await $.turn.start({ turnId: "g6" } as any);
    await call($, { tool: "Edit", file_path: "/work/src/a.ts" });
    await $.turn.start({ turnId: "g6-sub", agentId: "sub" } as any);
    await $.turn.complete(answer("g6-sub", { agentId: "sub" }));
    await $.turn.complete(answer("g6"));
    await settle();
    expect(h.forks()).toBe(1);
    expect(h.forkPrompts[0]).toContain("Files edited: src/a.ts");
  });

  test("a new turn forgets the last one's edits", async ($, on) => {
    const h = host(on, ONE);
    await $.turn.start({ turnId: "g4" } as any);
    await call($, { tool: "Edit", file_path: "/work/src/a.ts" });
    await $.turn.start({ turnId: "g5" } as any);
    await $.turn.complete(answer("g5"));
    await settle();
    expect(h.forkPrompts[0]).not.toContain("<observed>");
  });
});

describe("the card", () => {
  for (const surface of ["desktop", "terminal"] as const) {
    test(`on ${surface}, ${surface === "desktop" ? "shows" : "hides"} the card above the message box`, async ($, on) => {
      host(on, ONE);
      await $.turn.complete(answer("c1"));
      await settle();
      const band = await mount($, surface);
      const shown = surface === "desktop";
      expect(await hasText(band, /run the tests you just wrote/)).toBe(shown);
      expect(await hasText(band, /VERIFY/)).toBe(shown);
      expect(await hasText(band, /the change is unverified/)).toBe(shown);
      expect((await band.find({ key: "run" })) !== undefined).toBe(shown);
      await band.unmount();
    });
  }

  test("says it is working the moment the turn ends, then shows the advice", async ($, on) => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    host(on, ONE, { gate });
    await $.turn.complete(answer("c2"));
    const band = await mount($, "desktop");
    expect(await hasText(band, /working out the next step/)).toBe(true);
    release();
    await settle();
    expect(await hasText(band, /working out the next step/)).toBe(false);
    expect(await hasText(band, /run the tests you just wrote/)).toBe(true);
    await band.unmount();
  });

  test("a slash step is tagged as a skill", async ($, on) => {
    host(on, reply(STEP_REVIEW));
    await $.turn.complete(answer("c3"));
    await settle();
    const band = await mount($, "desktop");
    expect(await hasText(band, /SKILL/)).toBe(true);
    await band.unmount();
  });

  test("a new turn clears the card and the status", async ($, on) => {
    const h = host(on, ONE);
    await $.turn.complete(answer("c4"));
    await settle();
    const band = await mount($, "desktop");
    expect(await hasText(band, /run the tests/)).toBe(true);
    await $.turn.start({ turnId: "c5" } as any);
    expect(await hasText(band, /run the tests/)).toBe(false);
    expect(h.statuses.at(-1)).toBeUndefined();
    await band.unmount();
  });

  test("keeps the row of a mod after it in the band", async ($, on) => {
    host(on, ONE, {
      beneath: ($: any, e: any) =>
        $.ui.resolve(e).Text({ children: "cache meter" }),
    });
    await $.turn.complete(answer("c6"));
    await settle();
    const band = await mount($, "desktop");
    expect(await hasText(band, /run the tests you just wrote/)).toBe(true);
    expect(await hasText(band, /cache meter/)).toBe(true);
    await band.unmount();
  });

  test(
    'row "always" also draws in the terminal',
    { options: { row: "always" } } as any,
    async ($: any, on: any) => {
      host(on, ONE);
      await $.turn.complete(answer("c7"));
      await settle();
      const band = await mount($, "terminal");
      expect(await hasText(band, /run the tests you just wrote/)).toBe(true);
      await band.unmount();
    },
  );

  test(
    'row "off" draws nothing on the desktop',
    { options: { row: "off" } } as any,
    async ($: any, on: any) => {
      host(on, ONE);
      await $.turn.complete(answer("c8"));
      await settle();
      const band = await mount($, "desktop");
      expect(await hasText(band, /run the tests you just wrote/)).toBe(false);
      await band.unmount();
    },
  );

  test("the card offers Run, Edit and Dismiss, and nothing to page through", async ($, on) => {
    host(on, ONE);
    await $.turn.complete(answer("c9"));
    await settle();
    const band = await mount($, "desktop");
    expect(await band.find({ key: "run" })).toBeDefined();
    expect(await band.find({ key: "edit" })).toBeDefined();
    expect(await band.find({ key: "dismiss" })).toBeDefined();
    expect(await band.find({ key: "next" })).toBeUndefined();
    await band.unmount();
  });

  for (const surfaces of [["vscode"], []] as const) {
    test(`with nothing that can draw (${surfaces.length === 0 ? "headless" : surfaces[0]}), no advice is worked out after a turn`, async ($, on) => {
      const h = host(on, ONE, { surfaces: [...surfaces] });
      await $.turn.complete(answer("c10"));
      await settle();
      expect(h.forks()).toBe(0);
      expect(h.suggested).toEqual([]);
      expect(h.toasts).toEqual([]);
    });
  }

  test("one drawing surface among others is enough to advise", async ($, on) => {
    const h = host(on, ONE, { surfaces: ["vscode", "desktop"] });
    await $.turn.complete(answer("c11"));
    await settle();
    expect(h.forks()).toBe(1);
  });
});

describe("Run", () => {
  test("sends the step as the person's own message and clears the card", async ($, on) => {
    const h = host(on, ONE);
    await $.turn.complete(answer("r1"));
    await settle();
    const band = await mount($, "desktop");
    await band.press({ key: "run" });
    await settle();
    expect(h.submitted).toHaveLength(1);
    expect(h.submitted[0]!.text).toBe("run the tests you just wrote");
    expect(h.submitted[0]!.origin).toMatchObject({
      kind: "plugin",
      name: "up-next",
      asUser: true,
    });
    expect(await hasText(band, /run the tests you just wrote/)).toBe(false);
    await band.unmount();
  });

  test("runs a slash step as a command", async ($, on) => {
    const h = host(on, reply(STEP_REVIEW));
    await $.turn.complete(answer("r2"));
    await settle();
    const band = await mount($, "desktop");
    await band.press({ key: "run" });
    await settle();
    expect(h.commands).toEqual([{ command: "code-review", args: "high" }]);
    expect(h.submitted).toEqual([]);
    await band.unmount();
  });

  test("if sending is refused, says so and brings the card back", async ($, on) => {
    const h = host(on, ONE, { drop: "not now" });
    await $.turn.complete(answer("r3"));
    await settle();
    const band = await mount($, "desktop");
    await band.press({ key: "run" });
    await settle();
    expect(h.toasts.some((t) => t.includes("not now"))).toBe(true);
    expect(await hasText(band, /run the tests you just wrote/)).toBe(true);
    await band.unmount();
  });
});

describe("Edit", () => {
  test(
    "on the terminal, puts the step in the message box",
    { options: { row: "always" } } as any,
    async ($: any, on: any) => {
      const h = host(on, ONE);
      await $.turn.complete(answer("e1"));
      await settle();
      const band = await mount($, "terminal");
      await band.press({ key: "edit" });
      await settle();
      expect(h.filled).toEqual(["run the tests you just wrote"]);
      expect(await hasText(band, /run the tests you just wrote/)).toBe(false);
      await band.unmount();
    },
  );

  test("on the desktop, opens a field in the card and sends what you edit", async ($, on) => {
    // The desktop app's composer is out of a mod's reach: the fill is refused.
    const h = host(on, ONE, { composer: false });
    await $.turn.complete(answer("e2"));
    await settle();
    const band = await mount($, "desktop");
    await band.press({ key: "edit" });
    await settle();
    expect(h.filled).toEqual([]);
    expect(await band.find({ key: "draft" })).toBeDefined();
    expect(await hasText(band, /edit it, then press Enter/)).toBe(true);
    await band.input({ key: "draft", text: "run only the new tests" });
    await settle();
    expect(h.submitted.map((s) => s.text)).toEqual(["run only the new tests"]);
    await band.unmount();
  });

  test("Cancel returns to the card, Copy copies the draft", async ($, on) => {
    const h = host(on, ONE, { composer: false });
    await $.turn.complete(answer("e3"));
    await settle();
    const band = await mount($, "desktop");
    await band.press({ key: "edit" });
    await settle();
    await band.input({
      key: "draft",
      text: "run only the new tests",
      kind: "change",
    });
    await band.press({ key: "copy" });
    await settle();
    expect(h.copied).toEqual(["run only the new tests"]);
    await band.press({ key: "cancel" });
    await settle();
    expect(await band.find({ key: "run" })).toBeDefined();
    expect(await band.find({ key: "draft" })).toBeUndefined();
    await band.unmount();
  });

  test(
    "on the terminal, never overwrites a draft you have started, or fills a refused box",
    { options: { row: "always" } } as any,
    async ($: any, on: any) => {
      const h = host(on, [ONE, ONE], { box: "half a thought" });
      await $.turn.complete(answer("e4"));
      await settle();
      const band = await mount($, "terminal");
      await band.press({ key: "edit" });
      await settle();
      expect(h.filled).toEqual([]);
      expect(h.box()).toBe("half a thought");
      expect(await band.find({ key: "draft" })).toBeDefined();
      await band.press({ key: "cancel" });
      await settle();
      await band.unmount();
    },
  );

  test("puts the step in any message box that reports holding it", async ($, on) => {
    const h = host(on, ONE);
    await $.turn.complete(answer("e5"));
    await settle();
    const band = await mount($, "desktop");
    await band.press({ key: "edit" });
    await settle();
    expect(h.filled).toEqual(["run the tests you just wrote"]);
    expect(await band.find({ key: "draft" })).toBeUndefined();
    await band.unmount();
  });

  test("a fill into a box nobody can see falls back to the field", async ($, on) => {
    const h = host(on, ONE, { composer: "blind" });
    await $.turn.complete(answer("e6"));
    await settle();
    const band = await mount($, "desktop");
    await band.press({ key: "edit" });
    await settle();
    expect(await band.find({ key: "draft" })).toBeDefined();
    expect(h.toasts.some((t) => t.includes("message box: edit it"))).toBe(
      false,
    );
    await band.unmount();
  });
});

describe("Dismiss", () => {
  test("clears the card; the step is not asked for again, or offered if the advisor repeats it", async ($, on) => {
    const h = host(on, [ONE, ONE]);
    await $.turn.start({ turnId: "n2" } as any);
    await $.turn.complete(answer("n2"));
    await settle();
    const band = await mount($, "desktop");
    await band.press({ key: "dismiss" });
    await settle();
    expect(await band.find({ key: "run" })).toBeUndefined();

    await $.turn.start({ turnId: "n3" } as any);
    await $.turn.complete(answer("n3"));
    await settle();
    expect(h.forkPrompts[1]).toContain("- run the tests you just wrote");
    // The advisor repeated the dismissed step, so nothing is offered.
    expect(await band.find({ key: "run" })).toBeUndefined();
    expect(h.suggested).toEqual(["run the tests you just wrote"]);
    await band.unmount();
  });
});

describe("/next", () => {
  test("is registered when the session starts", async ($, on) => {
    const h = host(on, ONE);
    await $.session.start({
      surface: "desktop",
      isInteractive: true,
      cwd: "/work",
    } as any);
    expect(h.registered).toEqual(["next"]);
  });

  test("works out advice on demand and draws the card in its row", async ($, on) => {
    const h = host(on, ONE);
    const ran = await $.command.run({ command: "next" } as any);
    expect(ran.text).toContain("Up Next #1");
    await settle();
    expect(h.forks()).toBe(1);
    const row = await mount($, "desktop", "CommandOutput", {
      props: { command: "next", args: "", text: ran.text, isErrored: false },
    });
    expect(await hasText(row, /run the tests you just wrote/)).toBe(true);
    await row.press({ key: "run" });
    await settle();
    expect(h.submitted.map((s) => s.text)).toEqual([
      "run the tests you just wrote",
    ]);
    await row.unmount();
  });

  test("draws the card when the row's text carries the plugin's name", async ($, on) => {
    const h = host(on, ONE);
    await $.turn.complete(answer("x1"));
    await settle();
    const ran = await $.command.run({ command: "next" } as any);
    const row = await mount($, "terminal", "CommandOutput", {
      props: {
        command: "next",
        args: "",
        text: `up-next: ${ran.text}`,
        isErrored: false,
      },
    });
    expect(await hasText(row, /earlier advice/)).toBe(false);
    expect(await hasText(row, /run the tests you just wrote/)).toBe(true);
    expect(h.forks()).toBe(1);
    await row.unmount();
  });

  test("shows the standing advice without asking again, and marks older rows", async ($, on) => {
    const h = host(on, ONE);
    await $.turn.complete(answer("x1"));
    await settle();
    const first = await $.command.run({ command: "next" } as any);
    expect(first.text).toContain("run the tests you just wrote");
    const second = await $.command.run({ command: "next" } as any);
    await settle();
    expect(h.forks()).toBe(1);
    const old = await mount($, "desktop", "CommandOutput", {
      props: { command: "next", args: "", text: first.text, isErrored: false },
    });
    expect(await hasText(old, /earlier advice/)).toBe(true);
    const live = await mount($, "desktop", "CommandOutput", {
      props: { command: "next", args: "", text: second.text, isErrored: false },
    });
    expect(await live.find({ key: "run" })).toBeDefined();
    await old.unmount();
    await live.unmount();
  });

  test("says so when there is nothing worth doing", async ($, on) => {
    const h = host(on, reply());
    await $.command.run({ command: "next" } as any);
    await settle();
    expect(h.toasts.some((t) => t.includes("nothing worth doing next"))).toBe(
      true,
    );
  });

  test("where nothing draws, replies with the advice as text", async ($, on) => {
    const h = host(on, ONE, { surfaces: ["vscode"] });
    const ran = await $.command.run({ command: "next" } as any);
    expect(h.forks()).toBe(1);
    expect(ran.text).toBe(
      "Up Next [verify]: run the tests you just wrote\nthe change is unverified",
    );
    // No card to wait for, so nothing is left offered.
    const row = await mount($, "vscode", "CommandOutput", {
      props: { command: "next", args: "", text: ran.text, isErrored: false },
    });
    expect(await row.find({ key: "run" })).toBeUndefined();
    await row.unmount();
  });

  test("where nothing draws, says so in text when there is nothing worth doing", async ($, on) => {
    host(on, reply(), { surfaces: [] });
    const ran = await $.command.run({ command: "next" } as any);
    expect(ran.text).toBe("Up Next: nothing worth doing next.");
  });
});
