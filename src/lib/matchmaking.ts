import { getSupabase } from "./supabase";

export type MatchResult =
  | { kind: "human"; roomCode: string; opponentName: string; juzs: number[]; isHost: boolean }
  | { kind: "bot"; opponentName: string };

type QueueEntry = {
  id: string;
  name: string;
  juzs: number[];
  at: number;
};

export type QuickMatchHandle = {
  cancel: () => void;
};

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  return code;
}

function sortKey(entry: QueueEntry): string {
  return `${entry.at.toString().padStart(15, "0")}:${entry.id}`;
}

/**
 * Instant matchmaking over a shared Supabase Realtime presence channel.
 *
 * Every waiting player tracks itself on `thimar.matchmaking.queue`. When two
 * players are present, the deterministic earliest one (by join time, then id)
 * acts as host, mints a room code and broadcasts a `pair` event. Both sides
 * resolve with the same room. If no partner appears within `timeoutMs`, the
 * caller gets a bot match instead.
 */
export function quickMatch(options: {
  playerId: string;
  name: string;
  juzs: number[];
  timeoutMs?: number;
  onWaiting?: (secondsLeft: number) => void;
  onPaired?: (result: MatchResult) => void;
}): QuickMatchHandle {
  const timeoutMs = options.timeoutMs ?? 12000;
  const supabase = getSupabase();
  const me: QueueEntry = {
    id: options.playerId,
    name: options.name,
    juzs: options.juzs,
    at: Date.now(),
  };

  let settled = false;
  let channel: ReturnType<NonNullable<typeof supabase>["channel"]> | null = null;
  let countdown: number | null = null;
  let pairRetry: number[] = [];

  const finish = (result: MatchResult) => {
    if (settled) return;
    settled = true;
    cleanup();
    options.onPaired?.(result);
  };

  const cleanup = () => {
    if (countdown !== null) window.clearInterval(countdown);
    countdown = null;
    pairRetry.forEach((id) => window.clearTimeout(id));
    pairRetry = [];
    if (channel) {
      try {
        channel.untrack();
        supabase?.removeChannel(channel);
      } catch {
        /* ignore */
      }
      channel = null;
    }
  };

  // No realtime backend available: fall back to the bot immediately.
  if (!supabase) {
    const started = Date.now();
    countdown = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((timeoutMs - (Date.now() - started)) / 1000));
      options.onWaiting?.(left);
      if (left <= 0) finish({ kind: "bot", opponentName: "رفيق الذكاء" });
    }, 500);
    return { cancel: cleanup };
  }

  const ch = supabase.channel("thimar.matchmaking.queue", {
    config: { presence: { key: me.id }, broadcast: { self: false } },
  });
  channel = ch;

  const tryPair = () => {
    if (settled) return;
    const state = ch.presenceState() as Record<string, unknown[]>;
    const entries: QueueEntry[] = [];
    Object.values(state).forEach((bucket) => {
      (bucket as Array<Partial<QueueEntry>>).forEach((item) => {
        if (item && typeof item.id === "string" && typeof item.name === "string") {
          entries.push({
            id: item.id,
            name: item.name,
            juzs: Array.isArray(item.juzs) ? (item.juzs as number[]) : [],
            at: typeof item.at === "number" ? item.at : 0,
          });
        }
      });
    });
    const unique = Array.from(new Map(entries.map((e) => [e.id, e])).values());
    if (unique.length < 2) return;

    unique.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const host = unique[0];
    if (host.id !== me.id) return; // wait for host to announce

    // pick the guest with the highest juz overlap with host (rough match)
    const candidates = unique.slice(1);
    candidates.sort((a, b) => {
      const oa = a.juzs.filter((j) => host.juzs.includes(j)).length;
      const ob = b.juzs.filter((j) => host.juzs.includes(j)).length;
      if (ob !== oa) return ob - oa;
      return sortKey(a).localeCompare(sortKey(b));
    });
    const guest = candidates[0];
    const roomCode = makeRoomCode();
    const payload = {
      hostId: host.id,
      guestId: guest.id,
      roomCode,
      hostName: host.name,
      guestName: guest.name,
      hostJuzs: host.juzs,
      guestJuzs: guest.juzs,
    };
    const announce = () => {
      try {
        ch.send({ type: "broadcast", event: "pair", payload });
      } catch {
        /* ignore */
      }
    };
    announce();
    pairRetry = [300, 900, 1800].map((delay) => window.setTimeout(announce, delay));

    const inter = host.juzs.filter((j) => guest.juzs.includes(j));
    const shared = inter.length ? inter : (host.juzs.length ? host.juzs : guest.juzs);
    finish({ kind: "human", roomCode, opponentName: guest.name, juzs: shared, isHost: true });
  };

  ch.on("presence", { event: "sync" }, tryPair);
  ch.on("broadcast", { event: "pair" }, (message: { payload?: Record<string, unknown> }) => {
    const payload = message?.payload;
    if (!payload) return;
    if (payload.guestId !== me.id) return;
    const hostJuzs = Array.isArray(payload.hostJuzs) ? (payload.hostJuzs as number[]) : [];
    const guestJuzs = me.juzs;
    const inter = hostJuzs.filter((j) => guestJuzs.includes(j));
    const shared = inter.length ? inter : (hostJuzs.length ? hostJuzs : guestJuzs);
    finish({
      kind: "human",
      roomCode: String(payload.roomCode ?? ""),
      opponentName: String(payload.hostName ?? "خصم"),
      juzs: shared,
      isHost: false,
    });
  });

  ch.subscribe((status: string) => {
    if (status === "SUBSCRIBED") {
      ch.track(me).catch(() => {
        /* ignore */
      });
    }
  });

  const started = Date.now();
  countdown = window.setInterval(() => {
    const left = Math.max(0, Math.ceil((timeoutMs - (Date.now() - started)) / 1000));
    options.onWaiting?.(left);
    if (left <= 0) finish({ kind: "bot", opponentName: "رفيق الذكاء" });
  }, 500);

  return { cancel: cleanup };
}
