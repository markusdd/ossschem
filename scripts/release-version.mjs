/* Keep the two release manifests and their lockfile entries in sync.
 * Private implementation workspaces retain their internal 0.0.0 versions. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const paths = ["package.json", "apps/vscode/package.json", "package-lock.json"];
const [rootManifest, extensionManifest, lock] = paths.map((path) =>
  JSON.parse(readFileSync(resolve(root, path), "utf8")));
const [command, requestedVersion] = process.argv.slice(2);
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (command !== "set" && command !== "check") {
  throw new Error("usage: release-version.mjs set VERSION | check [VERSION]");
}
if (command === "set" && requestedVersion === undefined) {
  throw new Error("set requires a version");
}
const version = requestedVersion ?? rootManifest.version;
if (!versionPattern.test(version)) {
  throw new Error(`expected a major.minor.patch version, got ${version}`);
}
/* The lockfile carries its own copy of both names and versions, so a rename
 * that never reached it would ship a package built from a stale tree. Checked
 * against the manifests rather than against literals: renaming is allowed,
 * forgetting to run npm install after one is not. */
if (lock.name !== rootManifest.name || lock.packages?.[""]?.name !== rootManifest.name
  || lock.packages?.["apps/vscode"]?.name !== extensionManifest.name) {
  throw new Error("package-lock.json does not match the manifests; run npm install before releasing");
}

const fields = [
  ["package.json", rootManifest],
  ["apps/vscode/package.json", extensionManifest],
  ["package-lock.json", lock],
  ["package-lock.json packages['']", lock.packages[""]],
  ["package-lock.json packages['apps/vscode']", lock.packages["apps/vscode"]],
];

if (command === "check") {
  const mismatches = fields.filter(([, data]) => data.version !== version)
    .map(([path, data]) => `${path}: ${data.version}`);
  if (mismatches.length > 0) {
    throw new Error(`release version must be ${version}:\n${mismatches.join("\n")}`);
  }
  console.log(`release manifests match ${version}`);
} else {
  for (const [, data] of fields) data.version = version;
  for (const [path, data] of paths.map((path, i) => [path, [rootManifest, extensionManifest, lock][i]])) {
    writeFileSync(resolve(root, path), `${JSON.stringify(data, null, 2)}\n`);
  }
  console.log(`set release version to ${version}`);
}
