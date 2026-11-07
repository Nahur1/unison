// Builds the offline Persian translator to WebAssembly that old Android system
// WebViews can run (Android 7-10 phones may ship Chrome 70-era WebViews).
//
// Current Rust emits post-MVP WebAssembly by default (reference types,
// multi-value, bulk memory, non-trapping float-to-int, sign extension), which
// such WebViews reject ("WebAssembly.compile(): invalid local type"). So:
//   1. the crate is compiled without reference types and multi-value;
//   2. the target-features section is dropped (the prebuilt standard library
//      still lists reference types there, which would make wasm-bindgen
//      generate externref glue);
//   3. wasm-bindgen writes the classic "no-modules" glue for importScripts();
//   4. binaryen lowers the bulk-memory, float-to-int and sign-extension
//      instructions the standard library contains, and the result must
//      validate as plain MVP WebAssembly.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const crate = join(root, "translator");
const out = join(root, "public", "translation");
const exe = process.platform === "win32" ? ".exe" : "";
const run = (cmd, args, env = {}) =>
  execFileSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32" && !cmd.endsWith(exe || "\0"),
    env: { ...process.env, ...env },
  });

// The CLI must match the wasm-bindgen crate version in Cargo.lock exactly.
const lock = readFileSync(join(crate, "Cargo.lock"), "utf8");
const version = lock.match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)[1];

function wasmBindgen() {
  const candidates = [join(homedir(), ".cargo", "bin", `wasm-bindgen${exe}`)];
  for (const cache of [
    join(process.env.LOCALAPPDATA || "", ".wasm-pack"),
    join(homedir(), ".cache", ".wasm-pack"),
  ]) {
    if (!existsSync(cache)) continue;
    for (const dir of readdirSync(cache))
      if (dir.startsWith("wasm-bindgen-"))
        candidates.push(join(cache, dir, `wasm-bindgen${exe}`));
  }
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const found = execFileSync(path, ["--version"]).toString().trim();
    if (found === `wasm-bindgen ${version}`) return path;
  }
  run("cargo", ["install", "wasm-bindgen-cli", "--version", version, "--locked"]);
  return candidates[0];
}

run("cargo", ["build", "--manifest-path", join(crate, "Cargo.toml"), "--release", "--target", "wasm32-unknown-unknown"], {
  RUSTFLAGS: "-C target-feature=-reference-types,-multivalue",
});
const built = join(crate, "target", "wasm32-unknown-unknown", "release", "unison_translation.wasm");
const plain = join(crate, "target", "unison_translation.plain.wasm");
// Only the features rustc can emit: "--all-features" would also switch on newer
// encodings (compact imports) that wasm-bindgen cannot read.
run("npx", [
  "wasm-opt",
  built,
  "--enable-bulk-memory",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-reference-types",
  "--enable-multivalue",
  "--strip-target-features",
  "-o",
  plain,
]);

run(wasmBindgen(), ["--target", "no-modules", "--out-dir", out, "--out-name", "unison", plain]);

const wasm = join(out, "unison_bg.wasm");
run("npx", [
  "wasm-opt",
  wasm,
  "--enable-bulk-memory",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--llvm-memory-copy-fill-lowering",
  "--llvm-nontrapping-fptoint-lowering",
  "--signext-lowering",
  "-O3",
  "-o",
  wasm,
]);
// Fails if any post-MVP feature is still in use.
run("npx", ["wasm-opt", wasm, "--mvp-features", "-O3", "-o", wasm]);
rmSync(plain, { force: true });
console.log("Translator built as MVP WebAssembly:", wasm);
