// What the plugin saw happen during the turn, from tool calls and their results
// (not from the model's own account of them): which files changed, which checks
// ran, and which commands failed. Held in memory for the turn and handed to the
// advisor as a short block, so "was the last change verified?" rests on a fact.

import { clean } from "./advice";

export type Check = { command: string; failed: boolean; at: number };
export type Facts = {
  edits: Map<string, number>;
  checks: Check[];
  failures: string[];
  clock: number;
  lastEdit: number;
};

const COMMAND_MAX = 80;
const FILES_SHOWN = 8;
const FAILURES_KEPT = 3;

export function newFacts(): Facts {
  return { edits: new Map(), checks: [], failures: [], clock: 0, lastEdit: 0 };
}

// Commands that verify work. A heuristic: a miss only means the advisor is not
// told about one run, and the transcript it reads still shows it.
const CHECK_PATTERNS: readonly RegExp[] = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|type-check|check|build|validate|verify)\b/,
  /\b(?:vitest|jest|mocha|pytest|tox|nox|ruff|flake8|mypy|pyright|tsc|eslint|biome|rspec|phpunit|xcodebuild|swiftlint|golangci-lint)\b/,
  /\bgo\s+(?:test|vet|build)\b/,
  /\bcargo\s+(?:test|check|clippy|build)\b/,
  /\bswift\s+(?:test|build)\b/,
  /\bmake\s+(?:test|check|lint|build)\b/,
  /\b(?:gradle|gradlew|mvn)\b/,
  /\bdotnet\s+(?:test|build)\b/,
  /\bclaude\s+plugin\s+(?:test|validate)\b/,
  /\bpython3?\s+-m\s+(?:pytest|unittest|mypy|ruff)\b/,
];

export function isCheck(command: string): boolean {
  return CHECK_PATTERNS.some((pattern) => pattern.test(command));
}

export function recordEdit(facts: Facts, path: string): void {
  facts.clock += 1;
  facts.lastEdit = facts.clock;
  facts.edits.set(path, (facts.edits.get(path) ?? 0) + 1);
}

export function recordBash(
  facts: Facts,
  command: string,
  failed: boolean,
): void {
  const shown = clean(command, COMMAND_MAX);
  if (shown === "") return;
  if (isCheck(command)) {
    facts.clock += 1;
    facts.checks.push({ command: shown, failed, at: facts.clock });
  } else if (failed && facts.failures.length < FAILURES_KEPT) {
    facts.failures.push(shown);
  }
}

// Edits are unverified until a check that passed has run after the last one.
export function hasUnverifiedEdits(facts: Facts): boolean {
  return (
    facts.edits.size > 0 &&
    !facts.checks.some((check) => check.at > facts.lastEdit && !check.failed)
  );
}

function tail(path: string): string {
  return clean(path.split("/").filter(Boolean).slice(-2).join("/"), 60);
}

// The block the advisor reads; empty when nothing was observed.
export function describeFacts(facts: Facts): string {
  const lines: string[] = [];
  if (facts.edits.size > 0) {
    const files = [...facts.edits].map(([path, count]) =>
      count > 1 ? `${tail(path)} (${count} edits)` : tail(path),
    );
    const more =
      files.length > FILES_SHOWN
        ? `, and ${files.length - FILES_SHOWN} more`
        : "";
    lines.push(
      `Files edited: ${files.slice(0, FILES_SHOWN).join(", ")}${more}`,
    );
  }
  if (facts.checks.length > 0) {
    const ran = facts.checks.map(
      (check) => `\`${check.command}\` ${check.failed ? "failed" : "passed"}`,
    );
    lines.push(`Checks run, in order: ${ran.join("; ")}`);
  }
  if (facts.failures.length > 0) {
    lines.push(
      `Commands that failed: ${facts.failures.map((c) => `\`${c}\``).join("; ")}`,
    );
  }
  if (facts.edits.size > 0) {
    lines.push(
      hasUnverifiedEdits(facts)
        ? "No passing check has run since the last edit."
        : "A passing check has run since the last edit.",
    );
  }
  return lines.join("\n");
}
