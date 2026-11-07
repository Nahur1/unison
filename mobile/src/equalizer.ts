import type { Settings } from "./types";
import { BANDS } from "./types";
export class Equalizer {
  context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private filters: BiquadFilterNode[] = [];
  private preamp?: GainNode;
  async connect(element: HTMLMediaElement) {
    if (this.source) return;
    this.context = new AudioContext();
    this.source = this.context.createMediaElementSource(element);
    this.preamp = this.context.createGain();
    let tail: AudioNode = this.source;
    for (const frequency of BANDS) {
      const filter = this.context.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = 1;
      tail.connect(filter);
      tail = filter;
      this.filters.push(filter);
    }
    tail.connect(this.preamp);
    this.preamp.connect(this.context.destination);
    await this.context.resume();
  }
  async resume() {
    if (this.context?.state === "suspended") await this.context.resume();
  }
  apply(settings: Settings) {
    this.filters.forEach(
      (f, i) => (f.gain.value = settings.eq ? settings.gains[i] : 0),
    );
    if (this.preamp)
      this.preamp.gain.value = settings.eq ? 10 ** (settings.preamp / 20) : 1;
  }
}
