import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DynamicBorder,
  getAgentDir,
  isToolCallEventType,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Spacer, Text } from "@earendil-works/pi-tui";

type GitOperation = "commit" | "push";

type GitCommand = {
  command: string;
  end: number;
  operation: GitOperation;
  requiresRevalidation: boolean;
  start: number;
  title: string;
};

type ScriptCommand = {
  command: string;
  end: number;
  operation: "script";
  start: number;
  title: string;
};

type ProtectedCommand = GitCommand | ScriptCommand;

type ConfiguredScript = {
  command: string;
  title: string;
};

export type PermissionConfig = {
  includeDefaultGitCommands: boolean;
  scripts: ConfiguredScript[];
};

const CONFIG_FILE_NAME = "command-permission.json";
const DEFAULT_CONFIG: PermissionConfig = {
  includeDefaultGitCommands: true,
  scripts: [],
};

// Match git commands at shell command boundaries so ordinary text mentioning git is not gated.
const GIT_OPERATION_PATTERN =
  /(?:^|&&\s*|\|\|\s*|[;&|(\n]\s*)(env\s+|command\s+)?((?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*)(git\s+(?:(?:-[^\s]+)(?:\s+(?!-)[^\s]+)?\s+)*(commit(?:-tree)?|push)\b[^\n;&|]*)/gm;

const GIT_REVALIDATION_REASON =
  "Git commit or push was caught after a shell assignment. Stop and re-validate with the user whether you should be using Git before retrying with a direct Git command that shows the approval prompt.";

export default async function (pi: ExtensionAPI) {
  const config = await readPermissionConfig(getAgentDir());

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) {
      return;
    }

    const protectedCommands = findProtectedCommands(
      event.input.command,
      config,
    );
    if (protectedCommands.length === 0) {
      return;
    }

    const revalidationReason = getGitRevalidationReason(protectedCommands);
    if (revalidationReason) {
      emitPermissionDenied(pi, protectedCommands);
      return { block: true, reason: revalidationReason };
    }

    if (!ctx.hasUI) {
      emitPermissionDenied(pi, protectedCommands);
      return {
        block: true,
        reason: "Protected commands require interactive user approval.",
      };
    }

    const title = getConfirmationTitle(protectedCommands);
    const allowed =
      ctx.mode === "tui"
        ? await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
            const container = new Container();
            const selectList = new SelectList(
              [
                { value: "allow", label: "Allow" },
                { value: "deny", label: "Deny" },
              ],
              2,
              {
                selectedPrefix: (text) => theme.fg("accent", text),
                selectedText: (text) => theme.fg("accent", text),
                description: (text) => theme.fg("muted", text),
                noMatch: (text) => theme.fg("warning", text),
                scrollInfo: (text) => theme.fg("dim", text),
              },
            );

            container.addChild(
              new DynamicBorder((text: string) => theme.fg("warning", text)),
            );
            container.addChild(
              new Text(theme.fg("warning", theme.bold(title)), 1, 0),
            );
            container.addChild(new Spacer(1));
            container.addChild(new Text(theme.fg("muted", "Command:"), 1, 0));
            container.addChild(
              new Text(
                highlightProtectedCommands(
                  event.input.command,
                  protectedCommands,
                  (text) =>
                    theme.bg(
                      "selectedBg",
                      theme.fg("accent", theme.bold(text)),
                    ),
                ),
                1,
                0,
              ),
            );
            container.addChild(new Spacer(1));
            container.addChild(selectList);
            container.addChild(
              new Text(theme.fg("dim", "Enter allow • Esc deny"), 1, 0),
            );
            container.addChild(
              new DynamicBorder((text: string) => theme.fg("warning", text)),
            );

            selectList.onSelect = (item) => done(item.value === "allow");
            selectList.onCancel = () => done(false);

            return {
              handleInput: (data) => {
                selectList.handleInput(data);
                tui.requestRender();
              },
              invalidate: () => container.invalidate(),
              render: (width) => container.render(width),
            };
          })
        : await ctx.ui.confirm(title, event.input.command);

    if (!allowed) {
      emitPermissionDenied(pi, protectedCommands);
      return { block: true, reason: "Protected command denied by user." };
    }
  });
}

export async function readPermissionConfig(
  agentDir: string,
): Promise<PermissionConfig> {
  try {
    const content = await readFile(join(agentDir, CONFIG_FILE_NAME), "utf8");
    return parsePermissionConfig(JSON.parse(content) as unknown);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return DEFAULT_CONFIG;
    }

    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `Could not load ${CONFIG_FILE_NAME}; using default command protections: ${reason}`,
    );
    return DEFAULT_CONFIG;
  }
}

export function parsePermissionConfig(value: unknown): PermissionConfig {
  if (!isRecord(value)) {
    return DEFAULT_CONFIG;
  }

  const includeDefaultGitCommands =
    typeof value.includeDefaultGitCommands === "boolean"
      ? value.includeDefaultGitCommands
      : true;
  const scripts = Array.isArray(value.scripts)
    ? value.scripts.flatMap((script) => {
        if (!isRecord(script) || typeof script.command !== "string") {
          return [];
        }

        const command = script.command.trim();
        if (!isValidCommand(command)) {
          return [];
        }

        const title =
          typeof script.title === "string" && script.title.trim().length > 0
            ? script.title.trim()
            : command;
        return [{ command, title }];
      })
    : [];

  return { includeDefaultGitCommands, scripts };
}

export function findGitCommands(command: string): GitCommand[] {
  const gitCommands: GitCommand[] = [];

  for (const match of command.matchAll(GIT_OPERATION_PATTERN)) {
    const gitCommand = match[3];
    if (gitCommand === undefined) continue;

    const operation = match[4] === "push" ? "push" : "commit";
    const start = (match.index ?? 0) + match[0].lastIndexOf(gitCommand);
    gitCommands.push({
      command: gitCommand,
      end: start + gitCommand.length,
      operation,
      requiresRevalidation:
        match[1] === undefined && (match[2]?.length ?? 0) > 0,
      start,
      title: operation,
    });
  }

  return gitCommands;
}

export function getGitRevalidationReason(
  protectedCommands: readonly ProtectedCommand[],
): string | null {
  return protectedCommands.some(
    (protectedCommand) =>
      protectedCommand.operation !== "script" &&
      protectedCommand.requiresRevalidation,
  )
    ? GIT_REVALIDATION_REASON
    : null;
}

export function findProtectedCommands(
  command: string,
  config: PermissionConfig = DEFAULT_CONFIG,
): ProtectedCommand[] {
  const gitCommands = config.includeDefaultGitCommands
    ? findGitCommands(command)
    : [];
  const scriptCommands = config.scripts
    .flatMap((script) => findScriptCommands(command, script))
    .filter(
      (scriptCommand) =>
        !gitCommands.some((gitCommand) =>
          commandsOverlap(gitCommand, scriptCommand),
        ),
    );

  return [...gitCommands, ...scriptCommands].sort(
    (left, right) => left.start - right.start,
  );
}

function findScriptCommands(
  command: string,
  script: ConfiguredScript,
): ScriptCommand[] {
  const pattern = new RegExp(
    String.raw`(?:^|&&\s*|\|\|\s*|[;&|(\n]\s*)(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*|command\s+)?(${escapeRegExp(script.command)})(?=$|\s|[;&|()\n])`,
    "gm",
  );

  return Array.from(command.matchAll(pattern)).flatMap((match) => {
    const scriptCommand = match[1];
    if (scriptCommand === undefined) return [];

    const start = (match.index ?? 0) + match[0].lastIndexOf(scriptCommand);
    return [
      {
        command: scriptCommand,
        end: start + scriptCommand.length,
        operation: "script" as const,
        start,
        title: script.title,
      },
    ];
  });
}

function emitPermissionDenied(
  pi: ExtensionAPI,
  protectedCommands: ProtectedCommand[],
): void {
  pi.events.emit("pi-files:permission-denied", {
    operation: [
      ...new Set(
        protectedCommands.map((protectedCommand) => protectedCommand.operation),
      ),
    ].join("+"),
  });
}

export function getConfirmationTitle(
  protectedCommands: ProtectedCommand[],
): string {
  const gitOperations = [
    ...new Set(
      protectedCommands
        .filter((protectedCommand) => protectedCommand.operation !== "script")
        .map((protectedCommand) => protectedCommand.operation),
    ),
  ];
  const scriptTitles = [
    ...new Set(
      protectedCommands
        .filter(
          (protectedCommand): protectedCommand is ScriptCommand =>
            protectedCommand.operation === "script",
        )
        .map((protectedCommand) => protectedCommand.title),
    ),
  ];
  const titles = [
    ...(gitOperations.length > 0 ? [`Git ${gitOperations.join(" and ")}`] : []),
    ...scriptTitles,
  ];

  return `Allow ${titles.join(" and ")}?`;
}

export function highlightProtectedCommands(
  command: string,
  protectedCommands: ProtectedCommand[],
  highlight: (text: string) => string,
): string {
  const highlighted = protectedCommands.reduce(
    ({ text, end }, protectedCommand) => ({
      end: protectedCommand.end,
      text: `${text}${command.slice(end, protectedCommand.start)}${highlight(protectedCommand.command)}`,
    }),
    { end: 0, text: "" },
  );

  return `${highlighted.text}${command.slice(highlighted.end)}`;
}

function commandsOverlap(
  left: ProtectedCommand,
  right: ProtectedCommand,
): boolean {
  return left.start < right.end && right.start < left.end;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isFileNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidCommand(command: string): boolean {
  return command.length > 0 && !/[\n;&|]/.test(command);
}
