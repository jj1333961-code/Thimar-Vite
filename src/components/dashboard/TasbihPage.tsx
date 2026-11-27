import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { adhkarLibrary } from "../../data/adhkarLibrary";
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

type ShapeId = "ring" | "chain";

const SHAPES: Array<{ id: ShapeId; label: string }> = [
  { id: "ring", label: "حلقة" },
  { id: "chain", label: "سلسلة مائلة" },
];

/* ألوان حلقات السلسلة؛ تتكرر على طول الخط المائل. */
const CHAIN_COLORS = ["#0f5f4e", "#c9933f", "#b85555", "#3f6fa8", "#7a579e", "#4f8a5b", "#b06b8c"];

type Saved = {
  activeId: string;
  shape: ShapeId;
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
      const shape = SHAPES.some((item) => item.id === parsed.shape) ? (parsed.shape as ShapeId) : "ring";
      return {
        activeId,
        shape,
        counts: parsed.counts ?? {},
        rounds: parsed.rounds ?? {},
        targets: parsed.targets ?? {},
        custom: custom.map((item) => ({ ...item, target: Number(item.target) || 33, custom: true })),
      };
    }
  } catch {
    /* ignore */
  }
  return { activeId: BASE_DHIKR[0].id, shape: "ring", counts: {}, rounds: {}, targets: {}, custom: [] };
}

function shortText(text: string, limit = 34) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

function normalize(text: string) {
  return text
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

type Float = { id: number; left: number; top: number };

export default function TasbihPage() {
  const [state, setState] = useState<Saved>(load);
  const [floats, setFloats] = useState<Float[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [draftTarget, setDraftTarget] = useState("33");
  const [customTarget, setCustomTarget] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [chainStep, setChainStep] = useState(0);
  const [chainTransfer, setChainTransfer] = useState(0);
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

  const libraryResults = useMemo(() => {
    const q = normalize(libraryQuery);
    const source = q
      ? adhkarLibrary.filter((item) =>
          normalize(`${item.text} ${item.category} ${item.reference}`).includes(q),
        )
      : adhkarLibrary;
    return source.slice(0, 80);
  }, [libraryQuery]);

  const setTarget = (value: number) => {
    const clean = Math.max(1, Math.min(100000, Math.round(value) || 1));
    setState((prev) => ({ ...prev, targets: { ...prev.targets, [current.id]: clean } }));
  };

  /*
   * السلسلة الآن مسار منحنٍ من طرفين: خمس حلقات يمينًا وخمس يسارًا،
   * ولا حلقة في منتصف المسار. ترتيب العدّ من أقصى اليمين إلى أقصى اليسار.
   */
  const chainBeads = (["right", "left"] as const).flatMap((side) =>
    Array.from({ length: 5 }, (_, slot) => {
      const index = side === "right" ? slot : 5 + slot;
      const color = CHAIN_COLORS[index % CHAIN_COLORS.length];
      // انحناء إضافي داخل الذراع: الحلقات الداخلية أخفض قليلًا.
      const bend = (side === "right" ? slot : 4 - slot) * 1.6;
      return { id: `${side}-${slot}`, side, slot, index, color, bend };
    }),
  );
  const activeBead = ((chainStep % chainBeads.length) + chainBeads.length) % chainBeads.length;

  const tap = () => {
    navigator.vibrate?.(10);
    setChainStep((step) => step + 1);
    setChainTransfer((value) => value + 1);
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

  const resetRounds = () => {
    setState((prev) => ({ ...prev, rounds: { ...prev.rounds, [current.id]: 0 } }));
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

  const pickFromLibrary = (id: string, text: string, repeat: number) => {
    setState((prev) => {
      const exists = prev.custom.some((item) => item.id === id);
      const custom = exists
        ? prev.custom
        : [
            ...prev.custom,
            { id, text, target: Math.max(1, Math.min(1000, repeat || 33)), custom: true as const },
          ];
      return { ...prev, activeId: id, custom };
    });
    setLibraryOpen(false);
    setLibraryQuery("");
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
              title={item.text}
            >
              {shortText(item.text)}
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
          <button
            type="button"
            className={`chip tasbih-add${libraryOpen ? " active" : ""}`}
            onClick={() => setLibraryOpen((v) => !v)}
            aria-expanded={libraryOpen}
          >
            <Icon name="book" size={14} /> المكتبة ({adhkarLibrary.length})
          </button>
        </div>

        {/* شكل السبحة: حلقة دائرية أو سلسلة مائلة فقط. */}
        <div className="tasbih-shapes" role="group" aria-label="شكل السبحة">
          <span>الشكل</span>
          {SHAPES.map((shape) => (
            <button
              key={shape.id}
              type="button"
              className={`shape-dot ${state.shape === shape.id ? "active" : ""}`}
              aria-pressed={state.shape === shape.id}
              onClick={() => setState((prev) => ({ ...prev, shape: shape.id }))}
            >
              {shape.label}
            </button>
          ))}
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

      {libraryOpen ? (
        <div className="tasbih-library">
          <div className="tasbih-library-head">
            <strong>أذكار وأدعية للتسبيح</strong>
            <span className="muted">{adhkarLibrary.length} نصًا من حصن المسلم — دون إنترنت</span>
          </div>
          <input
            className="tasbih-library-search"
            value={libraryQuery}
            onChange={(event) => setLibraryQuery(event.target.value)}
            placeholder="ابحث في الأذكار والأدعية…"
            aria-label="بحث في المكتبة"
          />
          <div className="tasbih-library-list">
            {libraryResults.length === 0 ? <p className="muted">لا توجد نتائج مطابقة.</p> : null}
            {libraryResults.map((item) => (
              <button
                key={item.id}
                type="button"
                className="tasbih-library-item"
                onClick={() => pickFromLibrary(item.id, item.text, item.repeat)}
              >
                <span className="tasbih-library-text">{item.text}</span>
                <small className="muted">
                  {[item.reference, item.category].filter(Boolean).join(" — ")}
                </small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* الذكر المختار خارج السبحه ودائرة العدّ، كما طُلب. */}
      <div className="tasbih-current" aria-live="polite">
        <span className="tasbih-current-label">الذكر المختار</span>
        <p>{current.text}</p>
      </div>

      <div className={`tasbih-stage tasbih-shape-${state.shape}`}>
        <button
          type="button"
          className={`tasbih-touch${state.shape === "chain" ? " tasbih-touch--chain" : ""}`}
          onClick={tap}
          aria-label={`عدّ ${current.text}`}
        >
          {state.shape === "ring" ? (
            <span className="tasbih-dial">
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
                <strong className="tasbih-count">{count}</strong>
                <span className="tasbih-target">من {target}</span>
              </span>
            </span>
          ) : (
            <>
              <span className="tasbih-chain" aria-hidden="true">
                {(["right", "left"] as const).map((side) => (
                  <span key={side} className={`tasbih-chain-arm tasbih-chain-arm--${side}`}>
                    {chainBeads
                      .filter((bead) => bead.side === side)
                      .map((bead) => (
                        <span
                          key={bead.id}
                          className={`tasbih-chain-bead${bead.index === activeBead ? " is-active" : ""}${bead.index < activeBead ? " is-past" : ""}`}
                          style={{ "--slot": bead.slot, "--bend": `${bead.bend}px`, "--bead-color": bead.color } as CSSProperties}
                        />
                      ))}
                  </span>
                ))}
                <span key={chainTransfer} className="tasbih-chain-runner" />
              </span>
              <span className="tasbih-chain-count">
                <strong>{count}</strong>
                <span>من {target}</span>
              </span>
            </>
          )}
        </button>

        {floats.map((item) => (
          <span key={item.id} className="tasbih-plus" style={{ left: `${item.left}%`, top: `${item.top}%` }}>
            +1
          </span>
        ))}
      </div>

      <div className="tasbih-actions">
        <span className="muted tasbih-rounds">
          <Icon name="refresh" size={14} /> {rounds} دورة مكتملة
          <button
            type="button"
            className="tasbih-round-reset"
            onClick={resetRounds}
            disabled={rounds === 0}
            aria-label="حذف عدد الدورات المكتملة"
            title="حذف عدد الدورات المكتملة"
          >
            <Icon name="down" size={12} />
          </button>
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
