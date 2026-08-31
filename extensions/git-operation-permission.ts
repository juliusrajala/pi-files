import {
  DynamicBorder,
  isToolCallEventType,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Spacer, Text } from "@earendil-works/pi-tui";

type GitOperation = "commit" | "push";

type GitCommand = {
  command: string;
  end: number;
  operation: GitOperation;
  start: number;
};

// Match git commands at shell command boundaries so ordinary text mentioning git is not gated.
const GIT_OPERATION_PATTERN =
  /(?:^|&&\s*|\|\|\s*|[;&|(\n]\s*)(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*|command\s+)?(git\s+(?:(?:-[^\s]+)(?:\s+(?!-)[^\s]+)?\s+)*(commit(?:-tree)?|push)\b[^\n;&|]*)/gm;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) {
      return;
    }

    const gitCommands = findGitCommands(event.input.command);
    if (gitCommands.length === 0) {
      return;
    }

    if (!ctx.hasUI) {
      emitPermissionDenied(pi, gitCommands);
      return {
        block: true,
        reason: "Git commits and pushes require interactive user approval.",
      };
    }

    const title = getConfirmationTitle(gitCommands);
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
                highlightGitCommands(event.input.command, gitCommands, (text) =>
                  theme.bg("selectedBg", theme.fg("accent", theme.bold(text))),
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
      emitPermissionDenied(pi, gitCommands);
      return { block: true, reason: "Git commit or push denied by user." };
    }
  });
}

export function findGitCommands(command: string): GitCommand[] {
  const gitCommands: GitCommand[] = [];

  for (const match of command.matchAll(GIT_OPERATION_PATTERN)) {
    const gitCommand = match[1];
    if (gitCommand === undefined) continue;

    const operation = match[2] === "push" ? "push" : "commit";
    const start = (match.index ?? 0) + match[0].lastIndexOf(gitCommand);
    gitCommands.push({
      command: gitCommand,
      end: start + gitCommand.length,
      operation,
      start,
    });
  }

  return gitCommands;
}

function emitPermissionDenied(
  pi: ExtensionAPI,
  gitCommands: GitCommand[],
): void {
  pi.events.emit("pi-files:permission-denied", {
    operation: [
      ...new Set(gitCommands.map((gitCommand) => gitCommand.operation)),
    ].join("+"),
  });
}

export function getConfirmationTitle(gitCommands: GitCommand[]): string {
  const operations = [
    ...new Set(gitCommands.map((gitCommand) => gitCommand.operation)),
  ];
  return `Allow Git ${operations.join(" and ")}?`;
}

export function highlightGitCommands(
  command: string,
  gitCommands: GitCommand[],
  highlight: (text: string) => string,
): string {
  const highlighted = gitCommands.reduce(
    ({ text, end }, gitCommand) => ({
      end: gitCommand.end,
      text: `${text}${command.slice(end, gitCommand.start)}${highlight(gitCommand.command)}`,
    }),
    { end: 0, text: "" },
  );

  return `${highlighted.text}${command.slice(highlighted.end)}`;
}
