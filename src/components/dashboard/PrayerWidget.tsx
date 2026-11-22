import { useEffect, useState } from "react";
import {
  fallbackCities,
  fetchPrayerTimes,
  getCoordinates,
  prayerMethods,
  qiblaBearing,
  type PrayerData,
} from "../../lib/islamic";
import { Icon } from "./ui";

const PRAYER_LABELS: Array<{ key: keyof PrayerData["timings"]; name: string }> = [
  { key: "Fajr", name: "الفجر" },
  { key: "Sunrise", name: "الشروق" },
  { key: "Dhuhr", name: "الظهر" },
  { key: "Asr", name: "العصر" },
  { key: "Maghrib", name: "المغرب" },
  { key: "Isha", name: "العشاء" },
];

export default function PrayerWidget({ prayerMethod }: { prayerMethod: number }) {
  const [cityId, setCityId] = useState("makkah");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [cityName, setCityName] = useState("مكة المكرمة");
  const [data, setData] = useState<PrayerData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCoordinates()
      .then((position) => {
        if (cancelled) return;
        setCoords(position);
        setCityName("موقعك");
      })
      .catch(() => {
        const city = fallbackCities.find((item) => item.id === cityId) ?? fallbackCities[0];
        if (cancelled) return;
        setCoords({ lat: city.lat, lng: city.lng });
        setCityName(city.name);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!coords) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchPrayerTimes(coords.lat, coords.lng, prayerMethod, cityName)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (cancelled) return;
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        setError(err instanceof Error ? err.message : "تعذّر تحميل المواقيت.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coords, prayerMethod, cityName]);

  const remaining =
    data ? Math.max(0, Math.round((data.nextAt.getTime() - now) / 60000)) : 0;

  const bearing = coords ? qiblaBearing(coords.lat, coords.lng) : 0;

  return (
    <div className="prayer-widget">
      <div className="prayer-head">
        <div>
          <h4>مواقيت الصلاة</h4>
          <p>{cityName}{data?.dateLabel ? ` • ${data.dateLabel}` : ""}</p>
        </div>
        <select
          value={cityId}
          onChange={(event) => {
            const city = fallbackCities.find((item) => item.id === event.target.value);
            if (!city) return;
            setCityId(city.id);
            setCityName(city.name);
            setCoords({ lat: city.lat, lng: city.lng });
          }}
        >
          {fallbackCities.map((city) => (
            <option key={city.id} value={city.id}>
              {city.name}
            </option>
          ))}
        </select>
      </div>

      {loading && !data ? (
        <div className="skeleton-list">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="skeleton-line" />
          ))}
        </div>
      ) : error ? (
        <div className="error-box compact">
          <p>{error}</p>
        </div>
      ) : data ? (
        <>
          <div className="next-prayer">
            <div>
              <span className="next-label">الصلاة القادمة</span>
              <strong>{data.nextName}</strong>
            </div>
            <div className="next-countdown">
              <Icon name="clock" size={18} />
              <span>بعد {remaining} دقيقة</span>
            </div>
          </div>
          <div className="prayer-grid">
            {PRAYER_LABELS.map((item) => (
              <div
                key={item.key}
                className={`prayer-cell ${data.nextName === item.name ? "next" : ""}`}
              >
                <span className="prayer-name">{item.name}</span>
                <span className="prayer-time">{data.timings[item.key]}</span>
              </div>
            ))}
          </div>
          <div className="qibla">
            <div className="compass">
              <div className="compass-ring" />
              <div className="compass-needle" style={{ transform: `rotate(${bearing}deg)` }} />
              <span className="compass-center">ك</span>
            </div>
            <div className="qibla-info">
              <strong>اتجاه القبلة</strong>
              <span>{Math.round(bearing)}° من الشمال</span>
              <small>Method: {prayerMethods.find((item) => item.id === prayerMethod)?.name}</small>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
