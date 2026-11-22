import { useEffect, useMemo, useState } from "react";

/*
 * لوحة «ترتيب الكلمات»: تُعرض كلمات آية أو آيتين مبعثرة، ويبني المستخدم الترتيب
 * الصحيح بالضغط عليها. تُستخدم في الألغاز والاختبارات والتحدي بنفس الشكل.
 */

export function normalizeWord(word: string): string {
  return word.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
}

function wordsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((word, index) => normalizeWord(word) === normalizeWord(b[index]));
}

export default function WordOrderBoard({
  words,
  answer,
  onCheck,
  disabled = false,
  resetKey,
}: {
  words: string[];
  answer: string[];
  onCheck: (correct: boolean, arranged: string[]) => void;
  disabled?: boolean;
  resetKey?: string | number;
}) {
  const [picked, setPicked] = useState<number[]>([]);

  useEffect(() => {
    setPicked([]);
  }, [resetKey]);

  const remaining = useMemo(
    () => words.map((word, index) => ({ word, index })).filter((item) => !picked.includes(item.index)),
    [words, picked],
  );

  const arranged = picked.map((index) => words[index]).filter(Boolean);

  const check = () => {
    if (!arranged.length) return;
    onCheck(wordsMatch(arranged, answer), arranged);
  };

  return (
    <div className="word-order" dir="rtl">
      <div className="word-order-answer" aria-label="ترتيبك">
        {arranged.length === 0 ? (
          <span className="word-order-placeholder">اضغط الكلمات بالترتيب لبناء الآية…</span>
        ) : (
          picked.map((index, position) => (
            <button
              key={`${index}-${position}`}
              type="button"
              className="word-order-chip is-picked"
              disabled={disabled}
              onClick={() => setPicked((previous) => previous.filter((_, item) => item !== position))}
            >
              {words[index]}
            </button>
          ))
        )}
      </div>

      <div className="word-order-bank" aria-label="الكلمات المتاحة">
        {remaining.map((item) => (
          <button
            key={item.index}
            type="button"
            className="word-order-chip"
            disabled={disabled}
            onClick={() => setPicked((previous) => [...previous, item.index])}
          >
            {item.word}
          </button>
        ))}
      </div>

      <div className="word-order-actions">
        <button type="button" className="primary-button" onClick={check} disabled={disabled || !arranged.length}>
          تحقّق من الترتيب
        </button>
        <button type="button" className="ghost-button" onClick={() => setPicked([])} disabled={disabled || !picked.length}>
          إعادة
        </button>
      </div>
    </div>
  );
}
