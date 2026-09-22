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
const RUNTIME_PLATFORMS = new Set(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]);

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

if (withRuntime && !RUNTIME_PLATFORMS.has(platform)) {
  throw new Error(`no Node runtime is bundled for ${platform}; pass --no-runtime to build against the system one`);
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
run(resolve(root, "node_modules/.bin/esbuild"), [
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
writeFileSync(resolve(stage, "bin/ossschem"), launcher);
chmodSync(resolve(stage, "bin/ossschem"), 0o755);

if (withRuntime) {
  const archive = `node-${NODE_VERSION}-${platform}.tar.xz`;
  const cache = resolve(out, ".cache");
  mkdirSync(cache, { recursive: true });
  const tarball = resolve(cache, archive);
  if (!existsSync(tarball)) {
    console.log(`downloading ${archive}`);
    const url = `https://nodejs.org/dist/${NODE_VERSION}/${archive}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    writeFileSync(tarball, Buffer.from(await res.arrayBuffer()));
    // what nodejs.org says it should be, so a broken download is not shipped
    const sums = await (await fetch(`https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt`)).text();
    const expected = sums.split("\n").find((line) => line.endsWith(` ${archive}`))?.split(/\s+/)[0];
    const { createHash } = await import("node:crypto");
    const actual = createHash("sha256").update(readFileSync(tarball)).digest("hex");
    if (expected !== actual) {
      rmSync(tarball);
      throw new Error(`checksum mismatch for ${archive}`);
    }
  }
  // the interpreter alone: node needs no headers, no npm, no share tree
  mkdirSync(resolve(stage, "runtime/bin"), { recursive: true });
  run("tar", ["-xJf", tarball, "-C", resolve(stage, "runtime/bin"), "--strip-components=2",
    `node-${NODE_VERSION}-${platform}/bin/node`], out);
}

/* A launcher that resolves to nothing exits 0 with no output, which looks
 * exactly like success, so the package is not written until it has answered. */
const help = execFileSync(resolve(stage, "bin/ossschem"), ["--help"], { encoding: "utf8" });
if (!help.includes("ossschem build")) {
  throw new Error("the packaged command did not answer --help");
}

run("tar", ["-czf", `${name}.tar.gz`, name], out);
console.log(`\npackaged ${resolve(out, `${name}.tar.gz`)}`);
