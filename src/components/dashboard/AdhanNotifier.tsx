import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fetchPrayerTimes, getCoordinates } from "../../lib/islamic";
import { getAdhan } from "../../data/adhan";
import { loadSettings } from "../../lib/appStore";
import { recordAdhan } from "../../lib/adhanLog";
import { showSystemNotification } from "../../lib/notify";
import { PRAYER_ART, prayerImageUrl, type PrayerKey } from "../../data/prayerImages";
import {
  adhanLookFor,
  gregorianLabel,
  hijriLabel,
  type AdhanPrayerId,
} from "../../lib/adhanWindow";
import { scheduleIosAdhan, registerAdhanTapHandler } from "../../lib/adhanNative";
import { hasNativeAdhan, scheduleNativeAdhan, syncAdhanAssets } from "../../lib/adhanBridge";
import { Icon } from "./ui";

const PRAYERS: PrayerKey[] = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

type AdhanScreen = { key: PrayerKey; time: string; city: string; muezzin?: string };

/* نطلب إذن الإشعارات مرة واحدة فقط في كل تشغيل — إشعار وقت الصلاة هو ما يفتح شاشة الصلاة. */
let askedPrayerNotificationPermission = false;

export default function AdhanNotifier() {
  const [screen, setScreen] = useState<AdhanScreen | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const triggeredRef = useRef<Set<string>>(new Set());
  const lastNativeKeyRef = useRef("");
  const lastNativeAtRef = useRef(0);

  useEffect(() => {
    void registerAdhanTapHandler();
    let cancelled = false;
    let coords: { lat: number; lng: number } | null = null;

    const init = async () => {
      try {
        coords = await getCoordinates();
      } catch {
        coords = { lat: 21.4225, lng: 39.8262 };
      }
      if (cancelled) return;
      tick(coords);
    };

    const tick = async (c: { lat: number; lng: number }) => {
      const settings = loadSettings();
      // الصوت والشاشة والإشعارات مستقلة: إغلاق الصوت وحده لا يوقف شاشة الأذان أو الجدولة الأصلية.
      if (!settings.adhanSound && settings.adhanScreen === false && !settings.notifications) return;
      try {
        const data = await fetchPrayerTimes(c.lat, c.lng, settings.prayerMethod, "موقعك");
        if (cancelled) return;
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const timings = data.timings;
        const nativeApp = hasNativeAdhan();

        for (const key of PRAYERS) {
          if (settings.adhanPrayerEnabled?.[key] === false) continue;
          const t = timings[key as keyof typeof timings];
          if (!t) continue;
          const pMin = toMinutes(t);
          const art = PRAYER_ART[key];
          const label = art.label.replace("صلاة ", "");
          const dayKey = `${now.toDateString()}-${key}`;
          const soonKey = `${dayKey}-soon`;
          if (settings.notifications && nowMin >= pMin - 15 && nowMin < pMin - 1 && !triggeredRef.current.has(soonKey)) {
            triggeredRef.current.add(soonKey);
            void showSystemNotification(`اقترب وقت ${art.label}`, `بقي ${pMin - nowMin} دقيقة على ${art.label}.`, {
              image: prayerImageUrl(key),
              tag: `soon-${soonKey}`,
            });
          }
          if (Math.abs(nowMin - pMin) <= 1 && !triggeredRef.current.has(dayKey)) {
            triggeredRef.current.add(dayKey);
            const adhan = getAdhan(settings.adhanByPrayer?.[key] || settings.adhanId);
            recordAdhan({
              prayer: label,
              city: data.city || "موقعك",
              time: t,
              adhanId: adhan.id,
              adhanName: adhan.name,
            });
            /* على أندرويد الأصلي: المنبه والشاشة والصوت تتولاها الطبقة الأصلية،
               فلا نُشغّل صوتًا ثانيًا ولا نعرض نافذة مكررة. */
            if (!nativeApp) {
              if (settings.adhanSound) {
                if (!audioRef.current) audioRef.current = new Audio();
                const audio = audioRef.current;
                audio.src = adhan.url;
                audio.volume = Math.min(1, Math.max(0, settings.adhanVolume ?? 0.9));
                void audio.play().catch(() => undefined);
              }
              if (settings.adhanScreen !== false) {
                setScreen({ key, time: t, city: data.city || "موقعك", muezzin: adhan.muezzin || "" });
              }
              if (settings.notifications) {
                void showSystemNotification(`حان وقت ${art.label}`, art.phrase, {
                  image: prayerImageUrl(key),
                  tag: `adhan-${dayKey}`,
                });
              }
            }
          }
        }

        // جدولة أذان أندرويد أصلي (إن توفر الجسر).
        try {
          const nativeAdhan = (window as any).ThimarAdhan;
          if (nativeAdhan && typeof nativeAdhan.scheduleAdhan === "function") {
            const native = (window as any).ThimarNative;
            if (!askedPrayerNotificationPermission && native?.permission?.() === "prompt") {
              askedPrayerNotificationPermission = true;
              native.requestPermission?.();
            }
            const times: Record<string, string> = {};
            for (const key of PRAYERS) times[key] = timings[key as keyof typeof timings];
            const urls = Object.fromEntries(
              PRAYERS.map((key) => [key, getAdhan(settings.adhanByPrayer?.[key] || settings.adhanId).url]),
            );
            const payload = {
              times,
              master: settings.adhanSound,
              screen: settings.adhanScreen !== false,
              fajr: settings.adhanPrayerEnabled?.Fajr !== false,
              dhuhr: settings.adhanPrayerEnabled?.Dhuhr !== false,
              asr: settings.adhanPrayerEnabled?.Asr !== false,
              maghrib: settings.adhanPrayerEnabled?.Maghrib !== false,
              isha: settings.adhanPrayerEnabled?.Isha !== false,
              urls,
              defaultUrl: getAdhan(settings.adhanByPrayer?.[PRAYERS[0]] || settings.adhanId).url,
              volume: settings.adhanVolume ?? 0.9,
              volumeKeyMute: settings.adhanVolumeKeyMute !== false,
              city: data.city || "موقعك",
              lang: settings.language === "en" ? "en" : "ar",
              theme: settings.theme,
              imageUrls: Object.fromEntries(PRAYERS.map((key) => [key, prayerImageUrl(key)])),
            };
            const signature = JSON.stringify(payload);
            const changed = signature !== lastNativeKeyRef.current;
            const stale = Date.now() - lastNativeAtRef.current > 15 * 60 * 1000;
            if (changed || stale) {
              scheduleNativeAdhan(payload);
              lastNativeKeyRef.current = signature;
              lastNativeAtRef.current = Date.now();
            }
            if (changed) {
              // تنزيل الصور والأذان المختار مسبقًا للاستخدام دون إنترنت.
              syncAdhanAssets({ imageUrls: payload.imageUrls, urls, defaultUrl: payload.defaultUrl });
            }
          }
        } catch {
          /* ignore */
        }
        // جدولة إشعارات iOS/التطبيقات المثبتة (Capacitor) — لا تعتمد على مؤقّتات المتصفح.
        void scheduleIosAdhan(
          Object.fromEntries(PRAYERS.map((key) => [key, timings[key as keyof typeof timings]])),
          settings.adhanPrayerEnabled || {},
          settings.adhanSound,
        );
      } catch {
        /* ignore */
      }
    };

    init();
    const timer = window.setInterval(() => {
      if (coords) tick(coords);
    }, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      audioRef.current?.pause();
    };
  }, []);

  /* زر × هو وسيلة التحكم الوحيدة: يوقف الصوت ويُغلقه ويحرّر الموارد معًا. */
  const dismiss = () => {
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute("src");
        audio.load();
      } catch { /* ignore */ }
    }
    audioRef.current = null;
    setScreen(null);
  };

  if (!screen) return null;
  const today = new Date();
  /* هوية كل صلاة: لون وعبارة وزخرفة مختلفة — بلا أي صورة. */
  const look = adhanLookFor(screen.key.toLowerCase(), today);
  const gregorian = gregorianLabel(today, "ar");
  const hijri = hijriLabel(today, "ar");
  const style = {
    "--adhan-accent": look.accent,
    "--adhan-deep": look.deep,
  } as CSSProperties;

  return (
    <div
      className={`adhan-stage adhan-stage--${look.id}`}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label={`صلاة ${look.arabic}`}
    >
      <div className="adhan-stage-glow" aria-hidden="true" />
      <PrayerMotif id={look.id} />
      <div className="adhan-stage-frame" aria-hidden="true" />
      <div className="adhan-stage-inner">
        <header className="adhan-stage-head">
          <span className="adhan-stage-brand">ثمار • وقت الصلاة</span>
          <button type="button" className="adhan-stage-close" onClick={dismiss} aria-label="إغلاق شاشة الصلاة">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div className="adhan-stage-center">
          <span className="adhan-stage-overline">حان وقت الصلاة</span>
          <h2 className="adhan-stage-name">صلاة {look.arabic}</h2>
          <svg
            className="adhan-stage-rule"
            viewBox="0 0 200 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M0 6h78" />
            <path d="M122 6h78" />
            <path d="M100 1.5 104.5 6 100 10.5 95.5 6Z" fill="currentColor" stroke="none" />
          </svg>
          <p className="adhan-stage-time">{screen.time}</p>
          <p className="adhan-stage-phrase">{look.greetingAr}</p>
        </div>

        <footer className="adhan-stage-foot">
          {hijri ? <p className="adhan-stage-hijri">{hijri}</p> : null}
          <p className="adhan-stage-date">{gregorian}</p>
          <p className="adhan-stage-city">{screen.city}</p>
          {screen.muezzin ? <p className="adhan-stage-muezzin">بصوت المؤذن: {screen.muezzin}</p> : null}
        </footer>
      </div>
    </div>
  );
}

/* زخرفة لكل صلاة: هلال الفجر، شمس الظهر، شمس العصر المائلة، غروب المغرب، نجوم العشاء، أقواس الجمعة. */
function PrayerMotif({ id }: { id: AdhanPrayerId }) {
  return (
    <svg
      className="adhan-stage-motif"
      viewBox="0 0 240 240"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {id === "fajr" ? (
        <>
          <path d="M156 66a66 66 0 1 0 0 108 52 52 0 1 1 0-108Z" />
          <circle cx="72" cy="72" r="2.6" fill="currentColor" stroke="none" />
          <circle cx="98" cy="46" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="56" cy="112" r="1.5" fill="currentColor" stroke="none" />
        </>
      ) : null}

      {id === "dhuhr" || id === "asr" ? (
        <>
          <circle cx="120" cy="120" r={id === "asr" ? 34 : 40} />
          <path d="M120 62v-20M120 178v20M178 120h20M62 120H42" />
          <path d="M161 79l14-14M79 79 65 65M161 161l14 14M79 161l-14 14" />
          {id === "asr" ? <path d="M60 196h120" /> : null}
        </>
      ) : null}

      {id === "maghrib" ? (
        <>
          <path d="M76 150a44 44 0 0 1 88 0" />
          <path d="M120 74v-14M162 94l10-10M78 94 68 84M186 128h14M54 128H40" />
          <path d="M56 150h128" />
          <path d="M76 168h88" opacity="0.6" />
        </>
      ) : null}

      {id === "isha" ? (
        <>
          <path d="M142 46a34 34 0 1 0 0 56 27 27 0 1 1 0-56Z" />
          <circle cx="76" cy="62" r="2.4" fill="currentColor" stroke="none" />
          <circle cx="104" cy="122" r="1.8" fill="currentColor" stroke="none" />
          <circle cx="58" cy="110" r="1.5" fill="currentColor" stroke="none" />
          <path d="M52 184h136" />
          <path d="M92 184a28 28 0 0 1 56 0" />
          <path d="M112 156v-16" opacity="0.7" />
        </>
      ) : null}

      {id === "jumuah" ? (
        <>
          <path d="M62 182v-34a22 22 0 0 1 44 0v34" />
          <path d="M98 182v-46a22 22 0 0 1 44 0v46" />
          <path d="M134 182v-34a22 22 0 0 1 44 0v34" />
          <path d="M52 182h136" />
          <circle cx="120" cy="66" r="2.6" fill="currentColor" stroke="none" />
        </>
      ) : null}
    </svg>
  );
}
