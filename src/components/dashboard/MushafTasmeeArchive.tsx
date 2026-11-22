import { useMemo, useRef, useState } from "react";
import { ayahAudioUrl } from "../../data/reciters";
import { arabicNumber, surahNameOfNumber } from "../../lib/ayahImage";
import { deleteTasmeeSession, loadTasmeeSessions, scopeLabel, type TasmeeSession } from "../../lib/mushafTasmee";

/*
 * أرشيف تسميع المصحف: نتائج الجلسات المحفوظة من داخل المصحف، مع الكلمات التي
 * أخطأ فيها القارئ، وإمكانية سماع نطقها الصحيح بصوت قارئ.
 */

function formatDate(at: number): string {
  try {
    return new Date(at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "";
  }
}

export default function MushafTasmeeArchive({ refreshKey = 0 }: { refreshKey?: number }) {
  const [localRefresh, setLocalRefresh] = useState(refreshKey);
  const sessions = useMemo(() => loadTasmeeSessions(), [refreshKey, localRefresh]);
  const [playingKey, setPlayingKey] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const play = (global: number, key: string) => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.onended = () => setPlayingKey("");
    audio.src = ayahAudioUrl("ar.husary", global);
    audio.currentTime = 0;
    setPlayingKey(key);
    void audio.play().catch(() => setPlayingKey(""));
  };

  if (!sessions.length) {
    return <p className="muted">لا توجد تسميعات محفوظة من المصحف بعد.</p>;
  }

  return (
    <ul className="mushaf-tasmee-archive">
      {sessions.map((session: TasmeeSession, index) => (
        <li key={`${session.at}-${index}`} className="mushaf-tasmee-archive-item">
          <details>
            <summary>
              <span className="mushaf-tasmee-archive-title">{formatDate(session.at)}</span>
              <span className="mushaf-tasmee-archive-meta">
                {`${scopeLabel(session.scope)} • صفحة ${arabicNumber(session.page)} • دقة ${arabicNumber(session.accuracy)}% • أخطاء ${arabicNumber(session.wrong)}`}
              </span>
            </summary>
            <p className="mushaf-tasmee-archive-sub">
              {`${surahNameOfNumber(session.surah)} ${arabicNumber(session.fromAyah)}–${arabicNumber(session.toAyah)} • ${arabicNumber(session.correct)} من ${arabicNumber(session.total)} كلمة • ${arabicNumber(session.durationSec)} ثانية`}
            </p>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="ghost-button" onClick={() => { deleteTasmeeSession(session.at); setLocalRefresh((v) => v + 1); }}>
                حذف التسجيل
              </button>
            </div>
            {session.mistakes.length ? (
              <ul className="mushaf-tasmee-mistakes">
                {session.mistakes.map((item, mistakeIndex) => {
                  const key = `${index}-${mistakeIndex}`;
                  return (
                    <li key={key}>
                      <span className="mushaf-tasmee-mistake-word">{item.word}</span>
                      <span className="mushaf-tasmee-mistake-ref">{`${surahNameOfNumber(item.surah)} ${arabicNumber(item.ayah)}`}</span>
                      {item.spoken ? <span className="mushaf-tasmee-mistake-spoken">{`سمعت: ${item.spoken}`}</span> : null}
                      <button
                        type="button"
                        className="mushaf-tasmee-play"
                        onClick={() => play(item.global, key)}
                      >
                        {playingKey === key ? "يُشغّل…" : "النطق الصحيح"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mushaf-tasmee-archive-sub">لا أخطاء في هذه الجلسة.</p>
            )}
          </details>
        </li>
      ))}
    </ul>
  );
}
