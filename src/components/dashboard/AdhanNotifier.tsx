import { useEffect, useRef, useState } from "react";
import { fetchPrayerTimes, getCoordinates } from "../../lib/islamic";
import { getAdhan } from "../../data/adhan";
import { loadSettings } from "../../lib/appStore";
import { recordAdhan } from "../../lib/adhanLog";
import { showSystemNotification } from "../../lib/notify";
import { PRAYER_ART, prayerImageUrl, type PrayerKey } from "../../data/prayerImages";
import { gregorianLabel, hijriLabel } from "../../lib/adhanWindow";
import { scheduleIosAdhan, registerAdhanTapHandler } from "../../lib/adhanNative";
import { hasNativeAdhan, scheduleNativeAdhan, syncAdhanAssets } from "../../lib/adhanBridge";
import { Icon } from "./ui";

const PRAYERS: PrayerKey[] = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map((x) => parseInt(x, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

type AdhanScreen = { key: PrayerKey; time: string; city: string };

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
              if (settings.adhanScreen !== false) setScreen({ key, time: t, city: data.city || "موقعك" });
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
  const art = PRAYER_ART[screen.key];
  const today = new Date();
  const gregorian = gregorianLabel(today, "ar");
  const hijri = hijriLabel(today, "ar");

  /* بطاقة واحدة: كل المعلومات داخل مساحة الصورة، ولا شريط تحكم أسفلها. */
  return (
    <div className="adhan-screen" role="dialog" aria-modal="true" aria-label={art.label}>
      <div
        className="adhan-screen-backdrop"
        style={{ backgroundImage: `url(${art.image})` }}
        aria-hidden="true"
      />
      <div className="adhan-screen-panel">
        <div className="adhan-screen-card">
          <img
            className="adhan-screen-card-img"
            src={art.image}
            alt={`${art.label} — ${art.phrase}`}
            draggable={false}
          />
          <div className="adhan-screen-card-shade" aria-hidden="true" />
          <button type="button" className="adhan-screen-close" onClick={dismiss} aria-label="إغلاق شاشة الصلاة">
            <Icon name="x" size={16} />
          </button>
          <div className="adhan-screen-card-body">
            <span className="adhan-screen-kicker">ثمار — حان وقت الصلاة</span>
            <h2 className="adhan-screen-title">{art.label}</h2>
            <p className="adhan-screen-time">{screen.time}</p>
            <p className="adhan-screen-date">{gregorian} • {screen.city}</p>
            {hijri ? <p className="adhan-screen-hijri">{hijri}</p> : null}
            <p className="adhan-screen-motivation">{art.phrase}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
