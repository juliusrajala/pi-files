import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const piPodContainerEnvironment = "PI_POD_CONTAINER";

export function isPiPodContainer(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment[piPodContainerEnvironment] === "1";
}

export function piRuntimeLabel(environment: NodeJS.ProcessEnv = process.env): string {
  return isPiPodContainer(environment) ? "pi-pod" : "pi-root";
}

/** Always identify the current Pi runtime in the shared footer-status row. */
export default function piPodStatusExtension(pi: ExtensionAPI) {
  const inPod = isPiPodContainer();

  pi.on("session_start", (_event, ctx) => {
    const color = inPod ? "success" : "warning";
    const marker = ctx.ui.theme.fg(color, "●");
    const label = ctx.ui.theme.fg(color, piRuntimeLabel());
    ctx.ui.setStatus("pi-runtime", `${marker} ${label}  `);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("pi-runtime", undefined);
  });
}
