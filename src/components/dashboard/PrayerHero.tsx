import { useEffect, useRef, useState } from "react";
import {
  fallbackCities,
  fetchPrayerTimes,
  getCoordinates,
  type PrayerData,
} from "../../lib/islamic";
import type { Settings } from "../../lib/appStore";
import { sharePrayerCard } from "../../lib/prayerCard";

const PRAYER_LABELS: Array<{ key: keyof PrayerData["timings"]; name: string }> = [
  { key: "Fajr", name: "الفجر" },
  { key: "Sunrise", name: "الشروق" },
  { key: "Dhuhr", name: "الظهر" },
  { key: "Asr", name: "العصر" },
  { key: "Maghrib", name: "المغرب" },
  { key: "Isha", name: "العشاء" },
];

function countdownLabel(minutesLeft: number): string {
  if (minutesLeft <= 0) return "حان وقت الصلاة";
  const hours = Math.floor(minutesLeft / 60);
  const minutes = minutesLeft % 60;
  if (hours > 0) return `${hours} س ${minutes} د`;
  return `${minutes} دقيقة`;
}

export default function PrayerHero({
  settings,
}: {
  settings: Settings;
  onOpenAdhanLog?: () => void;
  onOpenSettings?: () => void;
}) {
  const [, setCityId] = useState("auto");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [cityName, setCityName] = useState("جارٍ تحديد الموقع…");
  const [data, setData] = useState<PrayerData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [, setLocating] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reloadKey, setReloadKey] = useState(0);
  const [cardBusy, setCardBusy] = useState(false);
  const [cardMessage, setCardMessage] = useState("");
  const locatedRef = useRef(false);

  /* بطاقة الصلاة: صورة جاهزة من ملفات التطبيق يُكتب عليها اسم الصلاة ووقتها وتاريخها. */
  const makePrayerCard = async () => {
    if (!data || cardBusy) return;
    setCardBusy(true);
    setCardMessage("");
    try {
      const label = PRAYER_LABELS.find((item) => item.name === data.nextName);
      const time = label ? data.timings[label.key] : "";
      const result = await sharePrayerCard({
        prayerName: data.nextName,
        time,
        date: new Date().toLocaleDateString("ar-EG", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        city: cityName,
      });
      setCardMessage(result === "shared" ? "تم تجهيز البطاقة" : "نُزّلت البطاقة في ملفات الجهاز");
    } catch {
      setCardMessage("تعذّر تجهيز بطاقة الصلاة");
    } finally {
      setCardBusy(false);
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const useFallbackCity = () => {
    let saved = "makkah";
    try {
      saved = localStorage.getItem("thimar.prayer.city") ?? "makkah";
    } catch {
      // ignore
    }
    const city = fallbackCities.find((item) => item.id === saved) ?? fallbackCities[0];
    setCityId(city.id);
    setCityName(city.name);
    setCoords({ lat: city.lat, lng: city.lng });
  };

  const locate = () => {
    setLocating(true);
    setError("");
    let settled = false;
    const fallbackTimer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setError("تعذّر تحديد الموقع بدقة؛ استخدمنا مدينة افتراضية ويمكنك تغييرها من القائمة.");
      useFallbackCity();
      setLocating(false);
    }, 15000);
    getCoordinates()
      .then((position) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(fallbackTimer);
        setCityId("auto");
        setCityName("موقعك الحالي");
        setCoords(position);
        /* نحفظ الموقع على الجهاز فلا يُطلب من المستخدم تحديده في كل دخول. */
        try {
          localStorage.setItem("thimar.prayer.coords", JSON.stringify(position));
          localStorage.setItem("thimar.prayer.city", "auto");
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(fallbackTimer);
        setError("لم نتمكن من الوصول إلى موقعك؛ اختر مدينة من القائمة أو اسمح بالموقع.");
        useFallbackCity();
      })
      .finally(() => {
        if (!settled) {
          settled = true;
          window.clearTimeout(fallbackTimer);
        }
        setLocating(false);
      });
  };

  useEffect(() => {
    if (locatedRef.current) return;
    locatedRef.current = true;
    let saved = "";
    try {
      saved = localStorage.getItem("thimar.prayer.city") ?? "";
    } catch {
      // ignore
    }
    /* موقع محفوظ من فتح سابق: نستخدمه مباشرة بلا طلب تحديد الموقع مجددًا. */
    try {
      const raw = localStorage.getItem("thimar.prayer.coords");
      const stored = raw ? (JSON.parse(raw) as { lat?: number; lng?: number }) : null;
      if (stored && typeof stored.lat === "number" && typeof stored.lng === "number") {
        setCityId("auto");
        setCityName("موقعك الحالي");
        setCoords({ lat: stored.lat, lng: stored.lng });
        return;
      }
    } catch {
      /* ignore */
    }
    if (!saved || saved === "auto") {
      locate();
      return;
    }
    const city = fallbackCities.find((item) => item.id === saved);
    if (city) {
      setCityId(city.id);
      setCityName(city.name);
      setCoords({ lat: city.lat, lng: city.lng });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* تغيير الموقع أو طريقة الحساب من صفحة الإعدادات ينعكس هنا مباشرة. */
  useEffect(() => {
    const sync = () => {
      let saved = "makkah";
      try {
        saved = localStorage.getItem("thimar.prayer.city") ?? "makkah";
      } catch {
        // ignore
      }
      if (saved === "auto") {
        try {
          const raw = localStorage.getItem("thimar.prayer.coords");
          const stored = raw ? (JSON.parse(raw) as { lat?: number; lng?: number }) : null;
          if (stored && typeof stored.lat === "number" && typeof stored.lng === "number") {
            setCityName("موقعك الحالي");
            setCoords({ lat: stored.lat, lng: stored.lng });
            return;
          }
        } catch {
          /* ignore */
        }
        locate();
        return;
      }
      const city = fallbackCities.find((item) => item.id === saved);
      if (!city) return;
      setCityId(city.id);
      setCityName(city.name);
      setCoords({ lat: city.lat, lng: city.lng });
    };
    window.addEventListener("thimar:settings", sync);
    return () => window.removeEventListener("thimar:settings", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchPrayerTimes(coords.lat, coords.lng, settings.prayerMethod, cityName)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (cancelled) return;
        // دون إنترنت نُبقي المواقيت المخزّنة ولا نُظهر رسالة اتصال.
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        setError(err instanceof Error ? err.message : "تعذّر تحميل المواقيت.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coords, settings.prayerMethod, cityName, reloadKey]);

  useEffect(() => {
    const retry = () => setReloadKey((key) => key + 1);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);

  const remaining = data ? Math.max(0, Math.round((data.nextAt.getTime() - now) / 60000)) : 0;

  return (
    <section className={`prayer-hero${data && remaining <= 0 ? " is-due" : ""}`} id="prayer-hero">
      <div className="prayer-hero-bg" />
      <div className="prayer-hero-inner">
        {loading && !data ? (
          <div className="prayer-loading">
            <span className="prayer-skeleton" />
            <span className="prayer-skeleton short" />
          </div>
        ) : error && !data ? (
          <div className="prayer-error">
            <p>{error}</p>
            <button type="button" className="ghost-button" onClick={() => setReloadKey((value) => value + 1)}>
              إعادة المحاولة
            </button>
          </div>
        ) : data ? (
          <div className="prayer-hero-main">
            <div className="prayer-next-big">
              <span>الصلاة القادمة</span>
              <strong>{data.nextName}</strong>
              <div className="prayer-countdown">{countdownLabel(remaining)}</div>
            </div>
            <div className="prayer-times-row">
              {PRAYER_LABELS.map((item) => (
                <div key={item.key} className={`prayer-time-card ${data.nextName === item.name ? "next" : ""}`}>
                  <span>{item.name}</span>
                  <strong>{data.timings[item.key]}</strong>
                </div>
              ))}
            </div>
            {/* بطاقة الصلاة تظهر فقط عند دخول وقت الصلاة، لا طوال اليوم. */}
            {remaining <= 0 ? (
              <div className="prayer-card-row prayer-card-row--due">
                <button type="button" className="ghost-button prayer-card-btn" onClick={() => void makePrayerCard()} disabled={cardBusy}>
                  {cardBusy ? "جارٍ تجهيز البطاقة…" : "بطاقة الصلاة"}
                </button>
                {cardMessage ? <span className="prayer-card-note">{cardMessage}</span> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {error && data ? <p className="prayer-warning">{error}</p> : null}
      </div>
    </section>
  );
}
