import { readFile } from "node:fs/promises";
const cargo = await readFile("../Cargo.toml", "utf8");
const version = cargo.match(/^version = "([^"]+)"/m)[1];
const app = JSON.parse(await readFile("package.json", "utf8"));
if (app.version !== version)
  throw Error("Mobile and desktop versions must match");
const native = await readFile("android/app/build.gradle", "utf8");
const [major, minor, patch] = version.split(".").map(Number);
if (minor >= 1000 || patch >= 100)
  throw Error("Android version code scheme needs updating");
const code = major * 1000000 + minor * 100 + patch;
if (
  !native.includes('versionName "' + version + '"') ||
  !native.includes("versionCode " + code)
)
  throw Error("Android versionName/versionCode do not match " + version);
if (
  !(await readFile("translator/Cargo.toml", "utf8")).includes(
    'version = "' + version + '"',
  )
)
  throw Error("Translator package version does not match");
console.log("Mobile, Android and translator versions agree:", version, code);
