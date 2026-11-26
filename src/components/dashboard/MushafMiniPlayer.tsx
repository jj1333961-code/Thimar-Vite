import { useEffect, useRef, useState } from "react";
import { formatTime, type AyahPlayer, type PlayerState } from "../../lib/ayahPlayer";

/*
 * المشغّل المصغّر فوق صفحة المصحف: مؤقت + إيقاف مؤقت/استئناف + إنهاء.
 * يختفي تلقائيًا بعد فترة من عدم اللمس، ويعود عند لمس الشاشة، ولا يمنع
 * القراءة أو تمرير الصفحة (الشريط وحده هو القابل للمس).
 * يستمع للمشغل بنفسه حتى لا يُعاد رسم صفحة المصحف مع كل تحديث للمؤقت.
 */
export default function MushafMiniPlayer({
  player,
  onStop,
}: {
  player: AyahPlayer;
  onStop: () => void;
}) {
  const [state, setState] = useState<PlayerState | null>(null);
  const [shown, setShown] = useState(false);
  const [activity, setActivity] = useState(0);
  const activeRef = useRef(false);

  useEffect(() => player.subscribe(setState), [player]);

  const active = Boolean(state && state.status !== "idle" && state.status !== "finished");
  activeRef.current = active;

  useEffect(() => {
    const bump = () => {
      if (!activeRef.current) return;
      setActivity((value) => value + 1);
    };
    window.addEventListener("pointerdown", bump, { passive: true });
    window.addEventListener("pointermove", bump, { passive: true });
    window.addEventListener("touchstart", bump, { passive: true });
    window.addEventListener("keydown", bump);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("pointermove", bump);
      window.removeEventListener("touchstart", bump);
      window.removeEventListener("keydown", bump);
    };
  }, []);

  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    setShown(true);
    const timer = window.setTimeout(() => setShown(false), 4200);
    return () => window.clearTimeout(timer);
  }, [active, activity, state?.status, state?.label, state?.round]);

  if (!state || !active) return null;

  const paused = state.status === "paused";
  const duration = state.duration > 0 ? state.duration : 0;
  const timer = duration
    ? `${formatTime(state.currentTime)} / ${formatTime(duration)}`
    : formatTime(state.currentTime);
  const repeatLabel = state.repeat > 1 ? ` • التكرار ${state.round}/${state.repeat}` : "";

  return (
    <div
      className={`mushaf-mini-player${shown ? " is-shown" : ""}`}
      role="group"
      aria-label="مشغل التلاوة"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="mushaf-mini-btn"
        onClick={() => player.toggle()}
        aria-label={paused ? "استئناف التشغيل" : "إيقاف مؤقت"}
        title={paused ? "استئناف" : "إيقاف مؤقت"}
      >
        {paused ? "▶️" : "⏸️"}
      </button>
      <span className="mushaf-mini-meta">
        <span className="mushaf-mini-label">{`${state.label}${repeatLabel}`}</span>
        <span className="mushaf-mini-time" dir="ltr">
          {timer}
        </span>
      </span>
      <button
        type="button"
        className="mushaf-mini-btn is-stop"
        onClick={onStop}
        aria-label="إنهاء التشغيل"
        title="إنهاء"
      >
        ⏺️
      </button>
    </div>
  );
}
