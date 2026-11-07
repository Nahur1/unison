let translator: { translate: (text: string) => string } | undefined;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const runtimeUrl = new URL("translation/unison.js", data.base).href;
      const { default: init, Translator } = await import(
        /* @vite-ignore */ runtimeUrl
      );
      await init();
      const base = new URL("translation/", data.base);
      const entries = await (await fetch(new URL("models.json", base))).json();
      const cache = await caches.open("unison-model-enfa-v1");
      const buffers: Uint8Array[] = [];
      for (const entry of entries) {
        const url = new URL(entry.name, base);
        let response = await cache.match(url);
        if (!response) {
          response = await fetch(url);
          if (!response.ok)
            throw Error("Could not load the offline Persian model");
        }
        const bytes = await response.arrayBuffer();
        const hash = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
          .map((x) => x.toString(16).padStart(2, "0"))
          .join("");
        if (hash !== entry.sha256)
          throw Error("Offline model integrity check failed");
        await cache.put(url, new Response(bytes));
        buffers.push(new Uint8Array(bytes));
        self.postMessage({
          type: "progress",
          value: buffers.length / entries.length,
        });
      }
      translator = new Translator(buffers[0], buffers[1], buffers[2]);
      self.postMessage({ type: "ready" });
    } else if (data.type === "translate") {
      if (!translator) throw Error("Prepare the offline model first");
      self.postMessage({
        type: "done",
        id: data.id,
        text: data.text,
        result: translator.translate(data.text),
      });
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id: data.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
