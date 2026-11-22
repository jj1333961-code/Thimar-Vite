import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./ui";

const KEY = "thimar.tasbih.v3";

type Dhikr = { id: string; text: string; target: number; custom?: boolean };

const BASE_DHIKR: Dhikr[] = [
  { id: "subhan", text: "سُبْحَانَ اللَّه", target: 33 },
  { id: "hamd", text: "الْحَمْدُ لِلَّه", target: 33 },
  { id: "akbar", text: "اللَّهُ أَكْبَر", target: 34 },
  { id: "tahlil", text: "لَا إِلَهَ إِلَّا اللَّه", target: 100 },
  { id: "istighfar", text: "أَسْتَغْفِرُ اللَّه", target: 100 },
  { id: "hawqala", text: "لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّه", target: 100 },
  { id: "salawat", text: "اللَّهُمَّ صَلِّ عَلَى مُحَمَّد", target: 100 },
];

const PRESET_TARGETS = [33, 100, 1000];
const BEADS = 33;

type Saved = {
  activeId: string;
  counts: Record<string, number>;
  rounds: Record<string, number>;
  targets: Record<string, number>;
  custom: Dhikr[];
};

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem("thimar.tasbih.v2");
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Saved>;
      const custom = Array.isArray(parsed.custom) ? parsed.custom.filter((item) => item?.text) : [];
      const activeId = [...BASE_DHIKR, ...custom].some((item) => item.id === parsed.activeId)
        ? String(parsed.activeId)
        : BASE_DHIKR[0].id;
      return {
        activeId,
        counts: parsed.counts ?? {},
        rounds: parsed.rounds ?? {},
        targets: parsed.targets ?? {},
        custom: custom.map((item) => ({ ...item, target: Number(item.target) || 33, custom: true })),
      };
    }
  } catch {
    /* ignore */
  }
  return { activeId: BASE_DHIKR[0].id, counts: {}, rounds: {}, targets: {}, custom: [] };
}

type Float = { id: number; left: number; top: number };

export default function TasbihPage() {
  const [state, setState] = useState<Saved>(load);
  const [floats, setFloats] = useState<Float[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftTarget, setDraftTarget] = useState("33");
  const [customTarget, setCustomTarget] = useState("");
  const floatId = useRef(0);

  const all = useMemo(() => [...BASE_DHIKR, ...state.custom], [state.custom]);
  const current = all.find((item) => item.id === state.activeId) ?? BASE_DHIKR[0];
  const count = state.counts[current.id] ?? 0;
  const rounds = state.rounds[current.id] ?? 0;
  const target = state.targets[current.id] ?? current.target;
  const progress = Math.min(1, count / Math.max(1, target));

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const setTarget = (value: number) => {
    const clean = Math.max(1, Math.min(100000, Math.round(value) || 1));
    setState((prev) => ({ ...prev, targets: { ...prev.targets, [current.id]: clean } }));
  };

  const tap = () => {
    navigator.vibrate?.(10);
    const id = (floatId.current += 1);
    setFloats((prev) => [...prev.slice(-6), { id, left: 50 + (Math.random() * 22 - 11), top: 42 + (Math.random() * 12 - 6) }]);
    window.setTimeout(() => setFloats((prev) => prev.filter((item) => item.id !== id)), 900);
    setState((prev) => {
      const value = (prev.counts[current.id] ?? 0) + 1;
      if (value >= target) {
        return {
          ...prev,
          counts: { ...prev.counts, [current.id]: 0 },
          rounds: { ...prev.rounds, [current.id]: (prev.rounds[current.id] ?? 0) + 1 },
        };
      }
      return { ...prev, counts: { ...prev.counts, [current.id]: value } };
    });
  };

  const addCustom = () => {
    const text = draftText.trim();
    if (!text) return;
    const value = Math.max(1, Math.min(100000, Number(draftTarget) || 33));
    const id = `custom-${Date.now()}`;
    setState((prev) => ({
      ...prev,
      activeId: id,
      custom: [...prev.custom, { id, text, target: value, custom: true }],
    }));
    setDraftText("");
    setDraftTarget("33");
    setComposerOpen(false);
  };

  const removeCustom = (id: string) => {
    setState((prev) => {
      const custom = prev.custom.filter((item) => item.id !== id);
      const counts = { ...prev.counts };
      const roundsMap = { ...prev.rounds };
      const targets = { ...prev.targets };
      delete counts[id];
      delete roundsMap[id];
      delete targets[id];
      return {
        ...prev,
        custom,
        counts,
        rounds: roundsMap,
        targets,
        activeId: prev.activeId === id ? BASE_DHIKR[0].id : prev.activeId,
      };
    });
  };

  return (
    <div className="tasbih-page">
      <div className="tasbih-top">
        <div className="tasbih-dhikr-list">
          {all.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`chip ${state.activeId === item.id ? "active" : ""}`}
              onClick={() => setState((prev) => ({ ...prev, activeId: item.id }))}
            >
              {item.text}
              {item.custom ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="tasbih-remove"
                  aria-label="حذف"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeCustom(item.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") removeCustom(item.id);
                  }}
                >
                  ×
                </span>
              ) : null}
            </button>
          ))}
          <button type="button" className="chip tasbih-add" onClick={() => setComposerOpen((v) => !v)}>
            <Icon name="plus" size={14} /> أضف ذكرك
          </button>
        </div>

        {/* ضبط عدد التكرار: 33 أو 100 أو 1000 أو أي عدد يكتبه المستخدم. */}
        <div className="tasbih-targets">
          <span className="tasbih-targets-label">العدد</span>
          {PRESET_TARGETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`chip ${target === preset ? "active" : ""}`}
              onClick={() => setTarget(preset)}
            >
              {preset}
            </button>
          ))}
          <input
            className="tasbih-target-input"
            value={customTarget}
            onChange={(event) => {
              const digits = event.target.value.replace(/[^\d]/g, "").slice(0, 6);
              setCustomTarget(digits);
              if (digits) setTarget(Number(digits));
            }}
            placeholder="عدد آخر"
            inputMode="numeric"
            aria-label="عدد مخصص"
          />
        </div>
      </div>

      {composerOpen ? (
        <div className="tasbih-composer">
          <input
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            placeholder="اكتب الذكر أو الدعاء…"
            aria-label="نص الذكر"
          />
          <input
            value={draftTarget}
            onChange={(event) => setDraftTarget(event.target.value.replace(/[^\d]/g, ""))}
            placeholder="العدد"
            inputMode="numeric"
            aria-label="عدد التكرار"
          />
          <button type="button" className="primary-button" onClick={addCustom}>
            إضافة
          </button>
        </div>
      ) : null}

      <div className="tasbih-stage">
        <button type="button" className="tasbih-touch" onClick={tap} aria-label={`عدّ ${current.text}`}>
          <span className="tasbih-ring" style={{ ["--progress" as string]: `${progress * 360}deg` }} />

          <span className="beads-ring" aria-hidden="true">
            {Array.from({ length: BEADS }, (_, index) => (
              <span
                key={index}
                className={`bead${index < Math.round(progress * BEADS) ? " lit" : ""}`}
                style={{ ["--angle" as string]: `${(index / BEADS) * 360}deg` }}
              />
            ))}
          </span>

          <span className="tasbih-inner">
            <span className="tasbih-text">{current.text}</span>
            <strong className="tasbih-count">{count}</strong>
            <span className="tasbih-target">من {target}</span>
          </span>
        </button>

        {floats.map((item) => (
          <span key={item.id} className="tasbih-plus" style={{ left: `${item.left}%`, top: `${item.top}%` }}>
            +1
          </span>
        ))}
      </div>

      <div className="tasbih-actions">
        <span className="muted">
          <Icon name="refresh" size={14} /> {rounds} دورة مكتملة
        </span>
        <button
          type="button"
          className="ghost-button"
          onClick={() => setState((prev) => ({ ...prev, counts: { ...prev.counts, [current.id]: 0 } }))}
        >
          تصفير العدّاد
        </button>
      </div>
    </div>
  );
}
