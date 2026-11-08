import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const files = [
  [
    "model.enfa.intgemm.alphas.bin",
    "456ad3952bcc59d208c76baba4dcef340ee4239416bd760d6fec27f9a16228f8",
  ],
  [
    "vocab.enfa.spm",
    "6435d3d9d766159fe192ab90892540b438ad7adb7ab4ea4049f68d0b4cdea3bd",
  ],
  [
    "lex.50.50.enfa.s2t.bin",
    "8542e7fb2bfa3a11b89f8392b8adb0dbbf863cd34569488b7c4535a91c3ae6b4",
  ],
];
await mkdir("public/icons", { recursive: true });
await mkdir("public/fonts", { recursive: true });
await mkdir("public/translation", { recursive: true });
for (const [source, dest] of [
  ["../ui/icons/unison-256.png", "public/icons/unison-256.png"],
  ["../ui/icons/unison-512.png", "public/icons/unison-512.png"],
  ["../ui/icons/unison-128.png", "public/icons/unison-128.png"],
  ["../ui/fonts/Inter-Regular.ttf", "public/fonts/Inter-Regular.ttf"],
  ["../ui/fonts/Inter-SemiBold.ttf", "public/fonts/Inter-SemiBold.ttf"],
  ["../ui/fonts/Vazirmatn.ttf", "public/fonts/Vazirmatn.ttf"],
])
  await copyFile(source, dest);
// Reuse the existing icon exports without changing the selected artwork.
const manifest = JSON.parse(
  await readFile("public/manifest.webmanifest", "utf8"),
);
manifest.icons[0] = {
  src: "icons/unison-256.png",
  sizes: "256x256",
  type: "image/png",
  purpose: "any",
};
await writeFile(
  "public/manifest.webmanifest",
  JSON.stringify(manifest, null, 2) + "\n",
);
for (const [name, sha256] of files) {
  const data = await readFile("../models/enfa/" + name);
  if (createHash("sha256").update(data).digest("hex") !== sha256)
    throw Error("Model checksum mismatch: " + name);
  await writeFile("public/translation/" + name, data);
}
await writeFile(
  "public/translation/models.json",
  JSON.stringify(
    files.map(([name, sha256]) => ({ name, sha256 })),
    null,
    2,
  ),
);
console.log("Existing artwork, fonts and verified offline model prepared.");
