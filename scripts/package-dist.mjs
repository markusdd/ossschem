/*
 * Build a relocatable ossschem distribution: the `ossschem` command, the
 * standalone viewer it writes, and the Node runtime that runs it.
 *
 * The point is a tarball that unpacks anywhere and works -- no npm, no
 * dependency resolution, nothing on PATH but the tool itself. The launcher
 * resolves its own directory, so the tree can be moved or symlinked into
 * ~/bin. Verilator is still the one thing it expects from the system: it is
 * what reads the RTL.
 *
 *   node scripts/package-dist.mjs [--platform linux-x64] [--version 1.2.3] [--no-runtime]
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/** Pinned so a build is reproducible; bump deliberately. */
const NODE_VERSION = "v24.21.0";
const RUNTIME_PLATFORMS = new Set(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win-x64"]);

const root = fileURLToPath(new URL("..", import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i < 0 || i + 1 >= argv.length ? undefined : argv[i + 1];
};
const hostPlatform = `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
const platform = flag("--platform") ?? hostPlatform;
const version = flag("--version") ?? JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const withRuntime = !argv.includes("--no-runtime");

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`expected a major.minor.patch version, got ${version}`);
}
if (withRuntime && !RUNTIME_PLATFORMS.has(platform)) {
  throw new Error(`no Node runtime is bundled for ${platform}; pass --no-runtime to build against the system one`);
}
if (platform !== hostPlatform) {
  throw new Error(`build ${platform} on a ${platform} host so the packaged launcher can be tested`);
}

const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });

const name = `ossschem-${version}-${platform}${withRuntime ? "" : "-nodeless"}`;
const out = resolve(root, "dist");
const stage = resolve(out, name);

run("npm", ["run", "build"]);
rmSync(stage, { recursive: true, force: true });
mkdirSync(resolve(stage, "bin"), { recursive: true });

/* One file, every dependency inlined: the tree has no node_modules to resolve
 * against. ESM, because the CLI locates the viewer beside itself through
 * import.meta.url. The entry runs the command outright -- the published one
 * decides by the name it was invoked as, which is not this one. */
const entry = resolve(out, ".entry.mjs");
mkdirSync(out, { recursive: true });
writeFileSync(entry, 'import { main } from "../packages/cli/dist/main.js";\n'
  + "process.exitCode = main(process.argv.slice(2));\n");
run(resolve(root, `node_modules/.bin/esbuild${process.platform === "win32" ? ".cmd" : ""}`), [
  entry,
  "--bundle", "--platform=node", "--format=esm", "--target=node20",
  `--outfile=${resolve(stage, "lib/ossschem.mjs")}`,
]);
rmSync(entry);

cpSync(resolve(root, "packages/cli/viewer"), resolve(stage, "viewer"), { recursive: true });
for (const file of ["LICENSE", "README.md", "INSTALL.md"]) {
  if (existsSync(resolve(root, file))) cpSync(resolve(root, file), resolve(stage, file));
}

const launcher = `#!/bin/sh
# ossschem, relocatable: everything it needs sits beside this script.
set -e
self=$0
# follow symlinks, so ~/bin/ossschem can point into an unpacked release
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case $link in
    /*) self=$link ;;
    *) self=$(dirname "$self")/$link ;;
  esac
done
root=$(CDPATH= cd -- "$(dirname -- "$self")/.." && pwd)
node="$root/runtime/bin/node"
if [ ! -x "$node" ]; then
  node=$(command -v node || true)
fi
if [ -z "$node" ]; then
  echo "ossschem: no Node runtime found beside this script or on PATH" >&2
  exit 1
fi
exec "$node" "$root/lib/ossschem.mjs" "$@"
`;
if (process.platform === "win32") {
  writeFileSync(resolve(stage, "bin/ossschem.cmd"), `@echo off\r\nsetlocal\r\nset "root=%~dp0.."\r\nset "node=%root%\\runtime\\node.exe"\r\nif not exist "%node%" set "node=node"\r\n"%node%" "%root%\\lib\\ossschem.mjs" %*\r\nexit /b %errorlevel%\r\n`);
} else {
  writeFileSync(resolve(stage, "bin/ossschem"), launcher);
  chmodSync(resolve(stage, "bin/ossschem"), 0o755);
}

if (withRuntime) {
  const archive = `node-${NODE_VERSION}-${platform}.${process.platform === "win32" ? "zip" : "tar.xz"}`;
  const cache = resolve(out, ".cache");
  mkdirSync(cache, { recursive: true });
  const tarball = resolve(cache, archive);
  if (!existsSync(tarball)) {
    console.log(`downloading ${archive}`);
    const url = `https://nodejs.org/dist/${NODE_VERSION}/${archive}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
  }
  // Verify cached downloads too, before shipping them in a release.
  const sumsResponse = await fetch(`https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`);
  if (!sumsResponse.ok) throw new Error(`could not fetch Node checksums: ${sumsResponse.status}`);
  const sums = await sumsResponse.text();
  const expected = sums.split("\n").find((line) => line.endsWith(` ${archive}`))?.split(/\s+/)[0];
  const { createHash } = await import("node:crypto");
  const actual = createHash("sha256").update(readFileSync(tarball)).digest("hex");
  if (!expected || expected !== actual) {
    rmSync(tarball);
    throw new Error(`checksum mismatch for ${archive}`);
  }
  // the interpreter alone: node needs no headers, no npm, no share tree
  if (process.platform === "win32") {
    mkdirSync(resolve(stage, "runtime"), { recursive: true });
    run("tar", ["-xf", tarball, "-C", resolve(stage, "runtime"), "--strip-components=1",
      `node-${NODE_VERSION}-${platform}/node.exe`], out);
  } else {
    mkdirSync(resolve(stage, "runtime/bin"), { recursive: true });
    run("tar", ["-xJf", tarball, "-C", resolve(stage, "runtime/bin"), "--strip-components=2",
      `node-${NODE_VERSION}-${platform}/bin/node`], out);
  }
  const node = resolve(stage, process.platform === "win32" ? "runtime/node.exe" : "runtime/bin/node");
  if (!existsSync(node) || execFileSync(node, ["--version"], { encoding: "utf8" }).trim() !== NODE_VERSION) {
    throw new Error(`bundled Node ${NODE_VERSION} is missing or cannot run on ${platform}`);
  }
}

/* A launcher that resolves to nothing exits 0 with no output, which looks
 * exactly like success, so the package is not written until it has answered. */
const help = execFileSync(resolve(stage, `bin/ossschem${process.platform === "win32" ? ".cmd" : ""}`), ["--help"], {
  encoding: "utf8", shell: process.platform === "win32",
});
if (!help.includes("ossschem build")) {
  throw new Error("the packaged command did not answer --help");
}

if (process.platform === "win32") {
  const zip = resolve(out, `${name}.zip`);
  run("tar", ["-caf", zip, name], out);
  console.log(`\npackaged ${zip}`);
} else {
  run("tar", ["-czf", `${name}.tar.gz`, name], out);
  console.log(`\npackaged ${resolve(out, `${name}.tar.gz`)}`);
}
