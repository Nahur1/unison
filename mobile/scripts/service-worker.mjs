import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
async function walk(dir) {
  const result = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) result.push(...(await walk(p)));
    else result.push(p);
  }
  return result;
}
const files = (await walk("dist")).filter(
  (p) =>
    !p.endsWith(".map") &&
    !p.includes("/.") &&
    !p.endsWith(".d.ts") &&
    !p.endsWith("/package.json") &&
    !/translation\/(model\.|vocab\.|lex\.)/.test(p),
);
const hash = createHash("sha256");
for (const file of files) hash.update(await readFile(file));
const version = hash.digest("hex").slice(0, 14);
const paths = files.map((p) => "./" + p.slice(5));
await writeFile(
  "dist/sw.js",
  `const CACHE='unison-shell-${version}';const SHELL=${JSON.stringify(paths)};
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('unison-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||event.request.headers.has('range'))return;
 event.respondWith((async()=>{const cached=await caches.match(event.request,{ignoreVary:true});if(cached)return cached;try{return await fetch(event.request);}catch(error){if(event.request.mode==='navigate')return (await caches.match(new URL('./index.html',self.registration.scope)))||Response.error();throw error;}})());});
`,
);
console.log("Offline shell generated:", version, paths.length, "assets.");
