import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function sessionLabel(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return environment.PI_SESH_SESSION
    ? `pi-sesh ${environment.PI_SESH_SESSION}`
    : "Pi · no session";
}

/** Record the container identity and show it in the footer. */
export default function sessionStatusExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const inPiSesh = Boolean(process.env.PI_SESH_SESSION);
    const color = inPiSesh ? "success" : "muted";
    const marker = ctx.ui.theme.fg(color, "●");
    const label = ctx.ui.theme.fg(color, sessionLabel());
    ctx.ui.setStatus("pi-sesh", `${marker} ${label}  `);
    if (process.env.PI_SESH_SESSION_ID) {
      pi.appendEntry("pi-sesh", {
        name: process.env.PI_SESH_SESSION,
        id: process.env.PI_SESH_SESSION_ID,
        cwd: ctx.cwd,
      });
    }
  });
  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("pi-sesh", undefined);
  });
}
