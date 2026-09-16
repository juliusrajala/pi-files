import assert from "node:assert/strict";
import test from "node:test";

import { isPiPodContainer, piRuntimeLabel } from "../extensions/pi-pod-status.ts";

test("distinguishes pi-pod from native Pi with an explicit footer label", () => {
  assert.equal(isPiPodContainer({ PI_POD_CONTAINER: "1" }), true);
  assert.equal(isPiPodContainer({ PI_POD_CONTAINER: "0" }), false);
  assert.equal(isPiPodContainer({}), false);
  assert.equal(piRuntimeLabel({ PI_POD_CONTAINER: "1" }), "pi-pod");
  assert.equal(piRuntimeLabel({}), "pi-root");
});
