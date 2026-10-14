// Up Next: when a main-loop turn ends, fork the session (it shares the prompt
// cache) with an advisor prompt and offer the one step most worth taking next,
// with its reason. Nothing is ever sent on its own: the step goes out only when
// the person presses Run (or Enter in the editor).
//
//  - desktop app: a card in the band above the message box (Run, Edit,
//    Dismiss), and the step as the message box's ghost text. The app's message
//    box is out of a mod's reach, so Edit opens a field in the card instead.
//  - terminal: the step is the message box's Tab-to-take ghost text and its
//    reason is in the status line; the card is there too when row is "always".
//  - /next: the same card in the transcript, and a way to ask for advice on
//    demand.
//  - Where nothing draws (the VS Code chat panel, claude -p, the Agent SDK) no
//    advice is worked out after a turn, since nobody could see it; /next there
//    replies with the advice as plain text.
//
// The engine's own guesses at the next prompt are dropped where they pass
// through prompt.suggest, so only one suggestion shows.

import type {
  Elements,
  EngineInterface,
  Register,
  RenderElement,
  RenderSurface,
} from "claude-code";
import {
  advisorPrompt,
  formatStep,
  labelOf,
  normalize,
  parseAdvice,
  skillList,
  splitCommand,
  type Label,
  type Step,
} from "./advice";
import {
  describeFacts,
  newFacts,
  recordBash,
  recordEdit,
  type Facts,
} from "./facts";

type View =
  | { kind: "hidden" }
  | { kind: "loading"; turnId: string }
  | { kind: "offer"; step: Step }
  | { kind: "edit"; step: Step; draft: string };

type Shown = Exclude<View, { kind: "hidden" }>;

// Input is missing on the mobile surface, so it is optional here.
type Kit = Pick<Elements["terminal"], "Box" | "Text" | "Button"> & {
  Input?: Elements["terminal"]["Input"];
};

type Settings = {
  minAnswerChars: number;
  showReason: boolean;
  ground: boolean;
  suggestSkills: boolean;
  row: "auto" | "always" | "off";
};

const TAG_COLOR: Record<Label, string> = {
  VERIFY: "success",
  UNBLOCK: "warning",
  ADVANCE: "suggestion",
  SKILL: "claude",
};

const SKIPPED_KEPT = 8;
const WATCHED: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "NotebookEdit",
  "Bash",
]);
const rowTag = (run: number) => `Up Next #${run}`;
// The engine shows a hook's answer under the plugin's name ("up-next: Up Next
// #2: ..."), so the row's text may carry that prefix before the tag.
const isRow = (text: string, run: number) =>
  text.replace(/^up-next: /, "").startsWith(`${rowTag(run)}:`);

// Session-local state; a hot reload resets it, which is fine.
let settings: Settings = settingsFrom(undefined);
let view: View = { kind: "hidden" };
let facts: Facts = newFacts();
let skipped: string[] = [];
let known: ReadonlySet<string> | null = null;
let hasInput = false;
let runs = 0;
let outcome = "";

function settingsFrom(
  options: Readonly<Record<string, unknown>> | undefined,
): Settings {
  return {
    minAnswerChars:
      typeof options?.minAnswerChars === "number" ? options.minAnswerChars : 80,
    showReason: options?.showReason !== false,
    ground: options?.groundAdvice !== false,
    suggestSkills: options?.suggestSkills !== false,
    row:
      options?.row === "always" || options?.row === "off"
        ? options.row
        : "auto",
  };
}

function kitOf(
  $: EngineInterface,
  e: Parameters<EngineInterface["ui"]["resolve"]>[0],
): Kit {
  const ui = $.ui.resolve(e);
  return {
    Box: ui.Box,
    Text: ui.Text,
    Button: ui.Button,
    Input: "Input" in ui ? ui.Input : undefined,
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// Notes what a tool call did, from its input and its outcome.
function observe(input: Record<string, unknown>, failed: boolean): void {
  if (input.tool === "Bash") {
    const command = text(input.command);
    if (command !== undefined) recordBash(facts, command, failed);
    return;
  }
  if (failed) return;
  const path = text(input.file_path) ?? text(input.notebook_path);
  if (path !== undefined) recordEdit(facts, path);
}

function show($: EngineInterface, next: View): void {
  view = next;
  $.ui.invalidate("ui.render");
}

function remember(prompt: string): void {
  const key = normalize(prompt);
  skipped = [...skipped.filter((p) => normalize(p) !== key), prompt].slice(
    -SKIPPED_KEPT,
  );
}

// The reason goes in the status line and the step is the message box's ghost
// text, where the surface shows one.
function announce($: EngineInterface, step: Step): void {
  $.ui.status(
    settings.showReason && step.why !== "" ? `next: ${step.why}` : undefined,
  );
  void $.prompt.suggest({ text: step.prompt }).catch(() => undefined);
}

function copy($: EngineInterface, value: string, surface: RenderSurface): void {
  void $.ui.copy({ text: value, surface }).then(
    (r) =>
      $.ui.toast(
        r.isCopied
          ? "Copied: paste it into the message box"
          : `Could not copy: ${r.reason}`,
      ),
    (error) => $.ui.toast(`Could not copy: ${String(error)}`),
  );
}

async function advise($: EngineInterface): Promise<Step | undefined> {
  // Without the list the advisor still works; slash steps go unchecked.
  const commands = await $.command.list().catch(() => null);
  known =
    commands === null ? null : new Set(commands.map((command) => command.name));
  const skills =
    settings.suggestSkills && commands !== null ? skillList(commands) : "";
  const reply = await $.model.fork({
    prompt: advisorPrompt({
      skills,
      facts: settings.ground ? describeFacts(facts) : "",
      skipped,
    }),
  });
  if (!reply.isAnswered) {
    $.ui.log(`no advice: ${reply.reason}`);
    return undefined;
  }
  const parsed = parseAdvice(reply.text, { known, skipped });
  if (!parsed.ok) {
    $.ui.log(`no advice: ${parsed.reason}`);
    return undefined;
  }
  return parsed.step;
}

// Only the terminal and the desktop app draw a mod's UI. Elsewhere (the VS Code
// chat panel, headless runs) advice nobody can see is not worth a model call.
async function canDraw($: EngineInterface): Promise<boolean> {
  const surfaces = await $.session.surfaces().catch(() => []);
  return surfaces.some((s) => s === "terminal" || s === "desktop");
}

async function deliver(
  $: EngineInterface,
  turnId: string,
  manual: boolean,
): Promise<void> {
  let step: Step | undefined;
  try {
    step = await advise($);
  } catch (error) {
    $.ui.log(`advisor failed: ${String(error)}`);
  }
  // A newer turn started while we waited: drop ours.
  if (view.kind !== "loading" || view.turnId !== turnId) return;
  if (step === undefined) {
    show($, { kind: "hidden" });
    if (manual) $.ui.toast("Up Next: nothing worth doing next");
    return;
  }
  outcome = "";
  show($, { kind: "offer", step });
  announce($, step);
}

// Sends the step as the person's own message (a slash step runs as a
// command). The card goes first so a second press cannot send it twice; if
// sending fails it comes back.
async function send(
  $: EngineInterface,
  message: string,
  restore: Shown,
): Promise<void> {
  const body = message.trim();
  if (body === "") return;
  outcome = "sent";
  show($, { kind: "hidden" });
  $.ui.status(undefined);
  try {
    const slash = splitCommand(body);
    if (slash !== null) {
      if (known !== null && !known.has(slash.command))
        throw new Error(`there is no /${slash.command} command here`);
      await $.command.run({ command: slash.command, args: slash.args });
    } else {
      const sent = await $.prompt.submit({ text: body, asUser: true });
      if (sent.drop !== undefined) throw new Error(sent.drop);
    }
  } catch (error) {
    outcome = "";
    show($, restore);
    $.ui.toast(`Could not send it: ${String(error)}`);
  }
}

// Edit: put the step in the message box as a draft wherever the session has a
// box that reports holding it afterwards (the terminal's), never over a draft
// the person has started. The desktop app draws its own composer, which a mod
// cannot reach, so there the fill is refused and the step opens in a field in
// the card instead; a fill that reports success but an empty box (one nobody
// can see) is treated the same way, so the step never vanishes.
async function edit($: EngineInterface, surface: RenderSurface): Promise<void> {
  const v = view;
  if (v.kind !== "offer") return;
  const step = v.step;
  const box = await $.prompt.read().catch(() => null);
  if (box !== null && box.text.trim() === "") {
    const filled = await $.prompt.fill({ text: step.prompt }).catch(() => null);
    if (
      filled?.isFilled === true &&
      normalize(filled.text) === normalize(step.prompt)
    ) {
      outcome = "moved to the message box";
      show($, { kind: "hidden" });
      $.ui.status(undefined);
      $.ui.toast("In the message box: edit it, then press Enter");
      return;
    }
  }
  if (!hasInput) {
    copy($, step.prompt, surface);
    return;
  }
  show($, { kind: "edit", step, draft: step.prompt });
}

function dismiss($: EngineInterface): void {
  const v = view;
  if (v.kind === "offer" || v.kind === "edit") remember(v.step.prompt);
  outcome = "dismissed";
  show($, { kind: "hidden" });
  $.ui.status(undefined);
}

function card($: EngineInterface, kit: Kit, v: Shown): RenderElement {
  const { Box, Text, Button, Input } = kit;
  if (v.kind === "loading")
    return <Text dimColor>up next: working out the next step…</Text>;
  const step = v.step;

  if (v.kind === "edit" && Input !== undefined) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>up next: edit it, then press Enter to send</Text>
        <Input
          key="draft"
          value={v.draft}
          submitLabel="send"
          autoFocus
          onInput={(value) => {
            if (view.kind === "edit") view = { ...view, draft: value };
          }}
          onSubmit={(value) => void send($, value, v)}
        />
        <Box flexDirection="row" gap={1}>
          <Button
            key="copy"
            label="Copy"
            plain
            onPress={(press) =>
              copy(
                $,
                view.kind === "edit" ? view.draft : step.prompt,
                press.surface,
              )
            }
          />
          <Button
            key="cancel"
            label="Cancel"
            plain
            onPress={() => show($, { kind: "offer", step })}
          />
        </Box>
      </Box>
    );
  }

  const label = labelOf(step);
  const rows = [
    <Box key="step" flexDirection="row" gap={1}>
      <Text bold inverse color={TAG_COLOR[label]}>{` ${label} `}</Text>
      <Text wrap="wrap">{step.prompt}</Text>
    </Box>,
  ];
  if (settings.showReason && step.why !== "")
    rows.push(
      <Text key="why" dimColor wrap="wrap">
        {step.why}
      </Text>,
    );
  rows.push(
    <Box key="buttons" flexDirection="row" gap={1}>
      <Button
        key="run"
        label="Run"
        variant="primary"
        onPress={() => void send($, step.prompt, v)}
      />
      <Button
        key="edit"
        label="Edit"
        onPress={(press) => void edit($, press.surface)}
      />
      <Button
        key="dismiss"
        label="Dismiss"
        plain
        role="dismiss"
        onPress={() => dismiss($)}
      />
    </Box>,
  );
  return (
    <Box flexDirection="column" paddingX={1}>
      {rows}
    </Box>
  );
}

export const register: Register = (on, options) => {
  settings = settingsFrom(options);

  // The engine's own guess at the next prompt would double what shows here.
  on("prompt.suggest", { origin: { kind: "suggestion" } }, () => ({
    isShown: false,
  }));

  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.command
      .register({
        name: "next",
        description: "Up Next: show the advised next step, or work one out now",
      })
      .catch(() => undefined);
    return result;
  });

  on("turn.start", async ($, e, next) => {
    // A subagent starting is not the person moving on.
    if ((e as { agentId?: string }).agentId === undefined) {
      facts = newFacts();
      if (view.kind !== "hidden") show($, { kind: "hidden" });
      if (settings.showReason) $.ui.status(undefined);
    }
    return next(e);
  });

  // Every tool call passes through; only edits and shell commands are noted.
  if (settings.ground)
    on("tool.call", async ($, e, next) => {
      if (!WATCHED.has(e.tool)) return next(e);
      const ran = await next(e);
      try {
        if (ran.deny === undefined)
          observe(
            e as unknown as Record<string, unknown>,
            ran.isError === true,
          );
      } catch {
        // Watching must never touch the call.
      }
      return ran;
    }).catch(($, e, next) => next(e));

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId !== undefined || e.reason !== "answer") return result;
    if (e.answer.trim().length < settings.minAnswerChars) return result;
    if (!(await canDraw($))) return result;
    const turnId = e.turnId;
    show($, { kind: "loading", turnId });
    void deliver($, turnId, false);
    return result;
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const below = await next(e);
    const current = view;
    const hasRow =
      settings.row === "always" ||
      (settings.row === "auto" && e.surface !== "terminal");
    if (
      !hasRow ||
      current.kind === "hidden" ||
      e.props.hasSurvey ||
      e.props.isWorking
    )
      return below;
    const kit = kitOf($, e);
    const { Box } = kit;
    hasInput = kit.Input !== undefined;
    const mine = card($, kit, current);
    // Ours first, so it sits right under the mods drawn before it.
    return below ? (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    ) : (
      mine
    );
  });

  // /next: the card as a transcript row. Only the latest run's row is live;
  // earlier ones say so.
  on(
    "ui.render",
    { component: "CommandOutput", props: { command: "next" } },
    ($, e) => {
      const kit = kitOf($, e);
      hasInput = kit.Input !== undefined;
      const { Text } = kit;
      if (!isRow(e.props.text, runs))
        return <Text dimColor>Up Next: earlier advice</Text>;
      if (view.kind === "hidden")
        return (
          <Text
            dimColor
          >{`Up Next: ${outcome === "" ? "nothing to show" : outcome}`}</Text>
        );
      return card($, kit, view);
    },
  );

  on("command.run", { command: "next" }, async ($) => {
    runs += 1;
    // Where nothing draws there is no card to wait for: work the advice out now
    // and reply with it as text.
    if (!(await canDraw($)))
      return { text: formatStep(await advise($).catch(() => undefined)) };
    if (view.kind === "hidden") {
      const turnId = `manual-${runs}`;
      show($, { kind: "loading", turnId });
      void deliver($, turnId, true);
    }
    return {
      text:
        view.kind === "offer"
          ? `${rowTag(runs)}: ${view.step.prompt}`
          : `${rowTag(runs)}: working out the next step…`,
    };
  });
};
