/*
 * Build a .vsix of the VS Code extension.
 *
 * The extension is a host for the viewer bundle, which lives outside its
 * folder, so the bundle is copied in first: a .vsix carries only what is
 * under the extension directory, and `findViewer` looks there before it looks
 * at the checkout.
 */
import { copyFileSync, cpSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const viewer = `${root}packages/cli/viewer`;
const bundled = `${root}apps/vscode/viewer`;

execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
if (!existsSync(`${viewer}/index.html`)) {
  throw new Error(`no viewer bundle at ${viewer}`);
}
rmSync(bundled, { recursive: true, force: true });
cpSync(viewer, bundled, { recursive: true });
// the licence travels with the package, not only with the checkout
copyFileSync(`${root}LICENSE`, `${root}apps/vscode/LICENSE`);

const vsce = `${root}node_modules/.bin/vsce`;
// A release tag supplies the VSIX version without changing the checkout.
execFileSync(vsce, ["package", "--no-dependencies", "--no-update-package-json", ...process.argv.slice(2)], {
  cwd: `${root}apps/vscode`, stdio: "inherit", shell: process.platform === "win32",
});
