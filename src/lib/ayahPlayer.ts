/*
 * مشغل صوت الآيات: طابور متتابع مع تكرار، وإيقاف مؤقت/استئناف من موضع التوقف
 * دون إعادة البدء، وإنهاء فوري. لا يتعامل مع الواجهة إطلاقًا، فيمكن عرض
 * التحكم في شريط مصغّر فوق المصحف دون فقدان الجلسة عند تقليب الصفحات.
 */

export type AyahPlayItem = {
  url: string;
  label: string;
};

export type PlayerStatus = "idle" | "playing" | "paused" | "finished" | "error";

export type PlayerState = {
  status: PlayerStatus;
  label: string;
  round: number;
  repeat: number;
  currentTime: number;
  duration: number;
  error: string;
};

const INITIAL: PlayerState = {
  status: "idle",
  label: "",
  round: 0,
  repeat: 1,
  currentTime: 0,
  duration: 0,
  error: "",
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "٠:٠٠";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export { formatTime };

export class AyahPlayer {
  private audio: HTMLAudioElement | null = null;
  private token = 0;
  private paused = false;
  private resumeWaiters: (() => void)[] = [];
  private listeners = new Set<(state: PlayerState) => void>();
  private state: PlayerState = { ...INITIAL };

  subscribe(listener: (state: PlayerState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): PlayerState {
    return this.state;
  }

  private emit(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("timeupdate", () => {
      this.emit({ currentTime: audio.currentTime, duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    });
    audio.addEventListener("loadedmetadata", () => {
      this.emit({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
    });
    this.audio = audio;
    return audio;
  }

  private async waitWhilePaused(token: number): Promise<void> {
    while (this.paused && token === this.token) {
      await new Promise<void>((resolve) => {
        this.resumeWaiters.push(resolve);
      });
    }
  }

  private playOne(item: AyahPlayItem, token: number): Promise<"ended" | "error" | "stopped"> {
    const audio = this.ensureAudio();
    audio.src = item.url;
    audio.currentTime = 0;
    this.emit({ label: item.label, currentTime: 0, duration: 0 });
    return new Promise((resolve) => {
      const cleanup = () => {
        audio.onended = null;
        audio.onerror = null;
      };
      audio.onended = () => {
        cleanup();
        resolve(token === this.token ? "ended" : "stopped");
      };
      audio.onerror = () => {
        cleanup();
        resolve(token === this.token ? "error" : "stopped");
      };
      void audio.play().then(
        () => undefined,
        () => {
          if (token !== this.token) return;
          cleanup();
          resolve("error");
        },
      );
    });
  }

  async start(items: AyahPlayItem[], repeat: number): Promise<void> {
    this.stop();
    if (!items.length) return;
    const token = ++this.token;
    this.paused = false;
    const rounds = Math.max(1, Math.round(repeat) || 1);
    this.emit({
      status: "playing",
      label: items[0].label,
      round: 1,
      repeat: rounds,
      currentTime: 0,
      duration: 0,
      error: "",
    });
    for (let round = 1; round <= rounds; round += 1) {
      if (token !== this.token) return;
      this.emit({ round });
      for (const item of items) {
        await this.waitWhilePaused(token);
        if (token !== this.token) return;
        const result = await this.playOne(item, token);
        if (token !== this.token) return;
        if (result === "error") {
          this.emit({
            status: "error",
            error: "تعذّر تشغيل التلاوة. تحقّق من اتصال الإنترنت أو اختر قارئًا آخر.",
          });
          this.releaseAudio();
          return;
        }
      }
    }
    if (token !== this.token) return;
    this.emit({ status: "finished", currentTime: 0 });
    this.releaseAudio();
  }

  pause(): void {
    if (this.state.status !== "playing") return;
    this.paused = true;
    this.audio?.pause();
    this.emit({ status: "paused" });
  }

  resume(): void {
    if (this.state.status !== "paused") return;
    this.paused = false;
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    waiters.forEach((resolve) => resolve());
    const audio = this.audio;
    if (audio && audio.src) void audio.play().catch(() => undefined);
    this.emit({ status: "playing" });
  }

  toggle(): void {
    if (this.state.status === "playing") this.pause();
    else if (this.state.status === "paused") this.resume();
  }

  stop(): void {
    this.token += 1;
    this.paused = false;
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    waiters.forEach((resolve) => resolve());
    this.releaseAudio();
    this.state = { ...INITIAL };
    this.listeners.forEach((listener) => listener(this.state));
  }

  private releaseAudio(): void {
    const audio = this.audio;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    try {
      audio.load();
    } catch {
      /* تجاهل */
    }
  }
}
