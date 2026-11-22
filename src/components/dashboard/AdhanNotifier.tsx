import { useEffect, useRef, useState } from "react";
import { fetchPrayerTimes, getCoordinates } from "../../lib/islamic";
import { getAdhan } from "../../data/adhan";
import { loadSettings } from "../../lib/appStore";
import { recordAdhan } from "../../lib/adhanLog";
import { showSystemNotification } from "../../lib/notify";
import { PRAYER_ART, prayerImageUrl, type PrayerKey } from "../../data/prayerImages";
import { scheduleIosAdhan, registerAdhanTapHandler } from "../../lib/adhanNative";
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
      if (!settings.adhanSound) return;
      try {
        const data = await fetchPrayerTimes(c.lat, c.lng, settings.prayerMethod, "موقعك");
        if (cancelled) return;
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const timings = data.timings;
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
            if (!audioRef.current) audioRef.current = new Audio();
            const audio = audioRef.current;
            audio.src = adhan.url;
            audio.volume = Math.min(1, Math.max(0, settings.adhanVolume ?? 0.9));
            audio.play().catch(() => {});
            recordAdhan({
              prayer: label,
              city: data.city || "موقعك",
              time: t,
              adhanId: adhan.id,
              adhanName: adhan.name,
            });
            setScreen({ key, time: t, city: data.city || "موقعك" });
            if (settings.notifications) {
              void showSystemNotification(`حان وقت ${art.label}`, art.phrase, {
                image: prayerImageUrl(key),
                tag: `adhan-${dayKey}`,
              });
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
          const payload = JSON.stringify({
            times,
            master: settings.adhanSound,
            screen: settings.adhanScreen !== false,
            fajr: settings.adhanPrayerEnabled?.Fajr !== false,
            dhuhr: settings.adhanPrayerEnabled?.Dhuhr !== false,
            asr: settings.adhanPrayerEnabled?.Asr !== false,
            maghrib: settings.adhanPrayerEnabled?.Maghrib !== false,
            isha: settings.adhanPrayerEnabled?.Isha !== false,
            urls: Object.fromEntries(PRAYERS.map((key) => [key, getAdhan(settings.adhanByPrayer?.[key] || settings.adhanId).url])),
            defaultUrl: getAdhan(settings.adhanByPrayer?.[PRAYERS[0]] || settings.adhanId).url,
            volume: settings.adhanVolume ?? 0.9,
          });
          nativeAdhan.scheduleAdhan(payload);
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

  const dismiss = () => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setScreen(null);
  };

  if (!screen) return null;
  const art = PRAYER_ART[screen.key];
  const today = new Date().toLocaleDateString("ar", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="adhan-screen" role="dialog" aria-modal="true" aria-label={art.label}>
      <img className="adhan-screen-image" src={art.image} alt={`${art.label} — ${art.phrase}`} draggable={false} />
      <div className="adhan-screen-card">
        <h2 className="adhan-screen-title">{art.label}</h2>
        <p className="adhan-screen-time">{screen.time}</p>
        <p className="adhan-screen-date">{today}</p>
        <p className="adhan-screen-motivation">{art.phrase}</p>
      </div>
      <div className="adhan-screen-foot">
        <span className="adhan-screen-meta">
          {screen.time} • {screen.city}
        </span>
        <button type="button" className="adhan-screen-close" onClick={dismiss} aria-label="إغلاق">
          <Icon name="x" size={16} /> ×
        </button>
      </div>
    </div>
  );
}
