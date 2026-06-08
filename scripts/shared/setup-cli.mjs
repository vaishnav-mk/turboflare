import { confirm, intro, isCancel, note, outro, password, text } from "@clack/prompts";
import { stdin as input, stdout as output } from "node:process";
import { execa } from "execa";

export const isInteractive = input.isTTY;
const scriptedAnswers = isInteractive ? null : (await readScriptedAnswers()).split(/\r?\n/);

export function start(title) {
  intro(title);
}

export function finish(message) {
  outro(message);
}

export function printNote(message, title) {
  if (isInteractive) {
    note(message, title);
    return;
  }

  output.write(title ? `${title}\n${message}\n` : `${message}\n`);
}

export async function promptText(label, defaultValue) {
  const suffix = defaultValue === undefined ? "" : ` (${defaultValue})`;
  if (!isInteractive) {
    output.write(`${label}${suffix}:\n`);
    const answer = scriptedAnswers.shift() ?? "";
    const trimmed = answer.trim();
    return trimmed.length === 0 && defaultValue !== undefined ? defaultValue : trimmed;
  }

  const answer = await text({ message: label, defaultValue, placeholder: defaultValue });
  return unwrapPrompt(answer).trim();
}

export async function promptSecret(label) {
  if (!isInteractive) {
    output.write(`${label}:\n`);
    return (scriptedAnswers.shift() ?? "").trim();
  }

  const answer = await password({ message: label });
  return unwrapPrompt(answer).trim();
}

export async function promptConfirm(label, defaultValue) {
  if (!isInteractive) {
    const answer = await promptText(`${label} ${defaultValue ? "[Y/n]" : "[y/N]"}`);
    if (answer.length === 0) {
      return defaultValue;
    }

    return /^(y|yes)$/i.test(answer);
  }

  return unwrapPrompt(await confirm({ message: label, initialValue: defaultValue }));
}

export async function run(command, args, options = {}) {
  const result = await withStep(options.label ?? `${command} ${args.join(" ")}`, () =>
    execa(command, args, {
      cwd: options.cwd,
      input: options.input,
      reject: false,
    }),
  );

  if (result.exitCode !== 0 && options.reject !== false) {
    const details = [result.stderr, result.stdout].filter(Boolean).join("\n");
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.exitCode}${details ? `\n${details}` : ""}`,
    );
  }

  return result;
}

export async function requireCommand(command, args, message) {
  const result = await execa(command, args, { reject: false });
  if (result.exitCode !== 0) {
    throw new Error(message);
  }
}

export async function withStep(label, task) {
  output.write(`◇ ${label}\n`);
  try {
    const result = await task();
    output.write(`◇ ${label} done\n`);
    return result;
  } catch (error) {
    output.write(`◇ ${label} failed\n`);
    throw error;
  }
}

export function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (isInteractive) {
    outro(`Setup failed: ${message}`);
  } else {
    console.error(`Setup failed: ${message}`);
  }
  process.exitCode = 1;
}

function unwrapPrompt(value) {
  if (isCancel(value)) {
    throw new Error("setup cancelled");
  }

  return value;
}

async function readScriptedAnswers() {
  const chunks = [];
  for await (const chunk of input) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}
