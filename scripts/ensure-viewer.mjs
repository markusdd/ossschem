/*
 * The webview page is assembled from the built viewer, so the tests need one
 * on disk. Built here when it is missing -- in CI, and in a fresh clone --
 * rather than left to whoever runs the tests to remember.
 */
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const index = fileURLToPath(new URL("../packages/cli/viewer/index.html", import.meta.url));
if (!existsSync(index)) {
  console.log("viewer bundle missing, building it first");
  execFileSync("npm", ["run", "build:viewer"], { stdio: "inherit", shell: process.platform === "win32" });
}
