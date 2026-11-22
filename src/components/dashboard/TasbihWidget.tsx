import { useEffect, useState } from "react";
import { Icon } from "./ui";

const KEY = "thimar.tasbih.v1";

const DHIKR = [
  { id: "subhan", text: "سُبْحَانَ اللَّه", target: 33 },
  { id: "hamd", text: "الْحَمْدُ لِلَّه", target: 33 },
  { id: "akbar", text: "اللَّهُ أَكْبَر", target: 34 },
  { id: "tahlil", text: "لَا إِلَهَ إِلَّا اللَّه", target: 100 },
  { id: "istighfar", text: "أَسْتَغْفِرُ اللَّه", target: 100 },
] as const;

type Saved = { dhikr: string; count: number; rounds: number };

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Saved>;
      return {
        dhikr: DHIKR.some((item) => item.id === parsed.dhikr) ? String(parsed.dhikr) : DHIKR[0].id,
        count: Number(parsed.count) || 0,
        rounds: Number(parsed.rounds) || 0,
      };
    }
  } catch {
    /* ignore */
  }
  return { dhikr: DHIKR[0].id, count: 0, rounds: 0 };
}

export default function TasbihWidget() {
  const [state, setState] = useState<Saved>(load);
  const current = DHIKR.find((item) => item.id === state.dhikr) ?? DHIKR[0];

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const tap = () => {
    navigator.vibrate?.(12);
    setState((prev) => {
      const next = prev.count + 1;
      if (next >= current.target) {
        return { ...prev, count: 0, rounds: prev.rounds + 1 };
      }
      return { ...prev, count: next };
    });
  };

  const progress = Math.min(1, state.count / current.target);

  return (
    <div className="tasbih-widget">
      <div className="tasbih-choices">
        {DHIKR.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`chip ${state.dhikr === item.id ? "active" : ""}`}
            onClick={() => setState((prev) => ({ ...prev, dhikr: item.id, count: 0 }))}
          >
            {item.text}
          </button>
        ))}
      </div>

      <button type="button" className="tasbih-counter" onClick={tap} aria-label="عدّ التسبيح">
        <span className="tasbih-ring" style={{ background: `conic-gradient(var(--primary) ${progress * 360}deg, color-mix(in srgb, var(--primary) 14%, var(--card)) 0deg)` }} />
        <span className="tasbih-inner">
          <span className="tasbih-text">{current.text}</span>
          <strong className="tasbih-count">{state.count}</strong>
          <span className="tasbih-target">من {current.target}</span>
        </span>
      </button>

      <div className="tasbih-actions">
        <span className="muted">
          <Icon name="refresh" size={14} /> {state.rounds} دورة مكتملة
        </span>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setState((prev) => ({ ...prev, count: 0 }))}
        >
          تصفير العدّاد
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setState({ dhikr: state.dhikr, count: 0, rounds: 0 })}
        >
          بداية جديدة
        </button>
      </div>
    </div>
  );
}
