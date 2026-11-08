import { readdir } from "node:fs/promises";
import { readFile, copyFile, mkdir, writeFile } from "node:fs/promises";
await mkdir("public/licenses", { recursive: true });
for (const [source, dest] of [
  ["../LICENSE", "LICENSE.txt"],
  ["../COPYRIGHT.md", "COPYRIGHT.md"],
  ["../THIRD_PARTY.md", "THIRD_PARTY.md"],
  ["../licenses/LEGACY-MIT.txt", "LEGACY-MIT.txt"],
  ["../ui/fonts/Inter-LICENSE.txt", "Inter-LICENSE.txt"],
  ["../ui/fonts/Vazirmatn-LICENSE.txt", "Vazirmatn-LICENSE.txt"],
])
  await copyFile(source, "public/licenses/" + dest);
const modelNotice =
  "English to Persian model v1.1: Mozilla Firefox Translations\nhttps://github.com/mozilla/firefox-translations-models\nMozilla Public License 2.0: https://mozilla.org/MPL/2.0/\nModel and vocabulary are distributed unchanged; checksums match scripts/prepare-offline.py.\n";
await writeFile("public/licenses/MODEL-NOTICE.txt", modelNotice);
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
let notice =
  "UNISON PLAYER · MOBILE COMPONENT NOTICES\n\n" +
  modelNotice +
  "\nThe mobile distribution uses Capacitor, React, lucide-react, music-metadata, wasm-bindgen, anyhow and AndroidX Media3, in addition to the bundled fonts. The desktop mpv/Slint binaries are not part of the mobile package.\n\n";
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue;
  try {
    const p = JSON.parse(await readFile(path + "/package.json", "utf8"));
    notice +=
      "\n--- " +
      p.name +
      " " +
      p.version +
      " · " +
      (p.license || "See package license") +
      " ---\n";
    const license = (await readdir(path)).find((f) =>
      /^licen[cs]e(?:\.|$)/i.test(f),
    );
    if (license) notice += await readFile(path + "/" + license, "utf8");
    notice += "\n";
  } catch (error) {
    throw Error(
      "Could not collect package notice for " + path + ": " + error.message,
    );
  }
}
for (const name of [
  "LICENSE.txt",
  "COPYRIGHT.md",
  "LEGACY-MIT.txt",
  "Inter-LICENSE.txt",
  "Vazirmatn-LICENSE.txt",
])
  notice +=
    "\n--- " +
    name +
    " ---\n" +
    (await readFile("public/licenses/" + name, "utf8"));
await writeFile("public/licenses/NOTICE.txt", notice);
console.log("Bundled font, model, project and JavaScript component notices.");
