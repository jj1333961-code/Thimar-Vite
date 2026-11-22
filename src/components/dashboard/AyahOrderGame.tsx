import { useCallback, useEffect, useMemo, useState } from "react";
import { loadQuranIndex, surahNameOf, type AyahInfo } from "../../lib/quranIndex";
import { aiChat } from "../../lib/ai";
import { Icon, SectionCard } from "./ui";

/* لغز «ترتيب الكلمات»: تُعرض كلمات آية أو آيتين متتاليتين مبعثرة، وعلى الطالب ترتيبها. */

type Round = {
  ayah: AyahInfo;
  words: string[];
  shuffled: string[];
  prompt: string;
  hint: string;
  verses: number;
};

const ROUNDS = 6;
const CANDIDATE_WORDS = { min: 4, max: 12 };

function normalize(word: string): string {
  return word.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export default function AyahOrderGame({ onExit }: { onExit: () => void }) {
  const [pool, setPool] = useState<AyahInfo[]>([]);
  const [bySurahAyah, setBySurahAyah] = useState<Map<string, AyahInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [round, setRound] = useState<Round | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [checked, setChecked] = useState<null | boolean>(null);
  const [score, setScore] = useState(0);
  const [asked, setAsked] = useState(0);
  const [used, setUsed] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadQuranIndex()
      .then((index) => {
        if (cancelled) return;
        const candidates = [...index.values()].filter((info) => {
          const count = info.text.split(/\s+/).filter(Boolean).length;
          return count >= CANDIDATE_WORDS.min && count <= CANDIDATE_WORDS.max;
        });
        setPool(candidates);
        setBySurahAyah(new Map([...index.values()].map((info) => [`${info.surah}:${info.ayah}`, info])));
      })
      .catch(() => {
        if (!cancelled) setError("تعذّر تحميل الآيات. تأكّد من تحميل المصحف في الإعدادات.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pickRandom = useCallback(
    (usedIds: number[]) => {
      const available = pool.filter((info) => !usedIds.includes(info.page * 10000 + info.ayah));
      const source = available.length ? available : pool;
      if (!source.length) return null;
      const chosen = source[Math.floor(Math.random() * source.length)];
      let words = chosen.text.split(/\s+/).filter(Boolean);
      let verses = 1;
      // سؤال من آية أو آيتين متتاليتين، ما دام مجموع الكلمات مناسبًا للشاشة.
      const next = bySurahAyah.get(`${chosen.surah}:${chosen.ayah + 1}`);
      if (next && words.length <= 12) {
        const nextWords = next.text.split(/\s+/).filter(Boolean);
        if (words.length + nextWords.length <= 24) {
          words = [...words, ...nextWords];
          verses = 2;
        }
      }
      return {
        ayah: chosen,
        words,
        shuffled: shuffle(words.map((word, index) => ({ word, index }))).map((item) => item.word),
        prompt:
          verses > 1
            ? `رتّب كلمات هاتين الآيتين من سورة ${surahNameOf(chosen.surah)} ترتيبًا صحيحًا.`
            : `رتّب كلمات هذه الآية من سورة ${surahNameOf(chosen.surah)} ترتيبًا صحيحًا.`,
        hint: "",
        verses,
      } satisfies Round;
    },
    [pool, bySurahAyah],
  );

  /* الراوي: صياغة السؤال والتلميح بالذكاء الاصطناعي مع نص الآية المحلي الموثّق. */
  const enhanceWithAi = useCallback(async (base: Round) => {
    try {
      const content = await aiChat(
        [
          {
            role: "system",
            content:
              "أنت مولّد ألغاز قرآنية في تطبيق تعليمي. اكتب سؤالًا عربيًا قصيرًا جدًا (سطر واحد) لترتيب كلمات آية أو آيتين، وتلميحًا قصيرًا (٥ كلمات كحد أقصى) دون كشف الترتيب كاملًا. أرجع JSON فقط: {\"prompt\":\"...\",\"hint\":\"...\"}",
          },
          {
            role: "user",
            content: `الآية: ${base.words.join(" ")}\nالسورة: ${surahNameOf(base.ayah.surah)}`,
          },
        ],
        { temperature: 0.7, maxTokens: 160 },
      );
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start === -1 || end <= start) return base;
      const parsed = JSON.parse(content.slice(start, end + 1)) as { prompt?: string; hint?: string };
      return {
        ...base,
        prompt: parsed.prompt?.trim() || base.prompt,
        hint: parsed.hint?.trim() || base.hint,
      };
    } catch {
      return base;
    }
  }, []);

  const startRound = useCallback(
    async (usedIds: number[]) => {
      const base = pickRandom(usedIds);
      if (!base) {
        setError("لا توجد آيات كافية لبدء اللغز.");
        return;
      }
      setRound(base);
      setPicked([]);
      setChecked(null);
      setUsed([...usedIds, base.ayah.page * 10000 + base.ayah.ayah]);
      const enhanced = await enhanceWithAi(base);
      setRound((current) =>
        current && current.ayah.ayah === base.ayah.ayah ? { ...current, prompt: enhanced.prompt, hint: enhanced.hint } : current,
      );
    },
    [enhanceWithAi, pickRandom],
  );

  useEffect(() => {
    if (pool.length && !round) void startRound([]);
  }, [pool.length, round, startRound]);

  const answerWords = useMemo(
    () => picked.map((index) => (round ? round.shuffled[index] : "")).filter(Boolean),
    [picked, round],
  );

  const remaining = useMemo(() => {
    if (!round) return [] as { word: string; index: number }[];
    return round.shuffled
      .map((word, index) => ({ word, index }))
      .filter((item) => !picked.includes(item.index));
  }, [picked, round]);

  const check = () => {
    if (!round || !answerWords.length) return;
    const correct = answerWords.map((word) => normalize(word)).join(" ") === round.words.map((word) => normalize(word)).join(" ");
    setChecked(correct);
    if (correct) setScore((value) => value + 1);
    setAsked((value) => value + 1);
  };

  const next = () => {
    if (asked >= ROUNDS) return;
    void startRound(used);
  };

  return (
    <div className="page games-page ayah-order-game">
      <div className="page-head">
        <div>
                      <h2>ترتيب الكلمات</h2>
          <p className="muted">رتّب الكلمات المبعثرة لتكوين آية أو آيتين كما في المصحف.</p>
        </div>
        <button type="button" className="ghost-button" onClick={onExit}>
          رجوع
        </button>
      </div>

      <SectionCard title={`الجولة ${Math.min(asked + 1, ROUNDS)} من ${ROUNDS}`} subtitle={`نقاطك: ${score}`}>
        {loading ? <p className="muted">جارٍ تجهيز الآيات…</p> : null}
        {error ? <p className="game-error">{error}</p> : null}

        {round ? (
          <>
            <p className="ayah-order-prompt">{round.prompt}</p>
            {round.hint ? <p className="muted">تلميح: {round.hint}</p> : null}

            <div className="ayah-order-answer" aria-label="ترتيبك">
              {answerWords.length === 0 ? <span className="ayah-order-placeholder">اضغط الكلمات بالترتيب…</span> : null}
              {picked.map((index, position) => (
                <button
                  key={`${index}-${position}`}
                  type="button"
                  className="ayah-order-chip picked"
                  onClick={() => setPicked((previous) => previous.filter((_, itemIndex) => itemIndex !== position))}
                >
                  {round.shuffled[index]}
                </button>
              ))}
            </div>

            <div className="ayah-order-bank">
              {remaining.map((item) => (
                <button
                  key={item.index}
                  type="button"
                  className="ayah-order-chip"
                  onClick={() => setPicked((previous) => [...previous, item.index])}
                >
                  {item.word}
                </button>
              ))}
            </div>

            {checked === null ? (
              <div className="ayah-order-actions">
                <button type="button" className="primary-button" onClick={check} disabled={answerWords.length === 0}>
                  تحقّق
                </button>
                <button type="button" className="ghost-button" onClick={() => setPicked([])}>
                  إعادة الترتيب
                </button>
              </div>
            ) : (
              <div className={`ayah-order-result ${checked ? "ok" : "bad"}`}>
                <p>
                  {checked ? "أحسنت، الترتيب صحيح." : "الترتيب غير صحيح. الترتيب الصحيح:"}
                </p>
                {!checked ? <p className="ayah-order-correct">{round.words.join(" ")}</p> : null}
                <p className="muted">
                  سورة {surahNameOf(round.ayah.surah)} — {round.verses > 1 ? `الآيتان ${round.ayah.ayah} و${round.ayah.ayah + 1}` : `الآية ${round.ayah.ayah}`}
                </p>
                <div className="ayah-order-actions">
                  <button type="button" className="primary-button" onClick={next} disabled={asked >= ROUNDS}>
                    {asked >= ROUNDS ? "انتهت الجولات" : "الآية التالية"}
                  </button>
                  <button type="button" className="ghost-button" onClick={onExit}>
                    إنهاء
                  </button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </SectionCard>

      <SectionCard title="كيف تلعب؟">
        <ul className="ayah-order-help">
          <li>
            <Icon name="sparkles" size={15} /> اضغط الكلمات واحدة بعد الأخرى لبناء الآية بالترتيب.
          </li>
          <li>
            <Icon name="check" size={15} /> اضغط أي كلمة في سطر الترتيب لإرجاعها.
          </li>
          <li>
            <Icon name="trend" size={15} /> ست جولات، وكل ترتيب صحيح يضيف نقطة.
          </li>
        </ul>
      </SectionCard>
    </div>
  );
}
