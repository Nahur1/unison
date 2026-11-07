export class OfflineTranslator {
  private worker?: Worker;
  private ready?: Promise<void>;
  private next = 0;
  private pending = new Map<
    number,
    { resolve: (value: string) => void; reject: (error: Error) => void }
  >();
  onProgress?: (value: number) => void;
  prepare() {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>((resolve, reject) => {
      this.worker = new Worker(
        new URL("./translation.worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = ({ data }) => {
        if (data.type === "progress") this.onProgress?.(data.value);
        if (data.type === "ready") resolve();
        if (data.type === "done") {
          this.pending.get(data.id)?.resolve(data.result);
          this.pending.delete(data.id);
        }
        if (data.type === "error") {
          const error = new Error(data.message);
          if (data.id) {
            this.pending.get(data.id)?.reject(error);
            this.pending.delete(data.id);
          } else {
            reject(error);
            this.worker?.terminate();
            this.ready = undefined;
          }
        }
      };
      this.worker.onerror = () => {
        const error = new Error(
          "Offline engine stopped. Try preparing the model again.",
        );
        reject(error);
        for (const p of this.pending.values()) p.reject(error);
        this.pending.clear();
        this.worker?.terminate();
        this.ready = undefined;
      };
      this.worker.postMessage({ type: "init", base: document.baseURI });
    });
    return this.ready;
  }
  async translate(text: string) {
    await this.prepare();
    return new Promise<string>((resolve, reject) => {
      const id = ++this.next;
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: "translate", id, text });
    });
  }
  close() {
    this.worker?.terminate();
    this.ready = undefined;
    for (const p of this.pending.values())
      p.reject(new Error("Translation cancelled"));
    this.pending.clear();
  }
}
