import { useEffect, useMemo, useState } from "react";
import {
  fallbackCities,
  fetchAdhanMonth,
  getCoordinates,
  prayerMethods,
  type CalendarDay,
} from "../../lib/islamic";
import { adhanLogForYear, clearAdhanLog } from "../../lib/adhanLog";
import { loadSettings } from "../../lib/appStore";
import { Icon } from "./ui";

const MONTHS = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
];

const PRAYERS: Array<{ key: keyof CalendarDay["timings"]; name: string }> = [
  { key: "Fajr", name: "الفجر" },
  { key: "Dhuhr", name: "الظهر" },
  { key: "Asr", name: "العصر" },
  { key: "Maghrib", name: "المغرب" },
  { key: "Isha", name: "العشاء" },
];

function cleanTime(value: string): string {
  return value.replace(/\s*\(.+\)$/, "").trim();
}

function readSavedPlace(): { city: string; lat: number; lng: number } {
  let saved = "makkah";
  try {
    saved = localStorage.getItem("thimar.prayer.city") ?? "makkah";
  } catch { /* ignore */ }
  if (saved === "auto") {
    try {
      const raw = localStorage.getItem("thimar.prayer.coords");
      if (raw) {
        const parsed = JSON.parse(raw) as { lat: number; lng: number };
        if (typeof parsed.lat === "number" && typeof parsed.lng === "number") {
          return { city: "موقعك الحالي", ...parsed };
        }
      }
    } catch { /* ignore */ }
  }
  const city = fallbackCities.find((item) => item.id === saved) ?? fallbackCities[0];
  return { city: city.name, lat: city.lat, lng: city.lng };
}

export default function AdhanLogPage({ onBack }: { onBack: () => void }) {
  const [place, setPlace] = useState(readSavedPlace);
  const [cityId, setCityId] = useState(() => {
    try { return localStorage.getItem("thimar.prayer.city") ?? "makkah"; } catch { return "makkah"; }
  });
  const [locating, setLocating] = useState(false);
  const [method, setMethod] = useState(() => loadSettings().prayerMethod);
  const year = new Date().getFullYear();
  const [openMonth, setOpenMonth] = useState<number | null>(new Date().getMonth() + 1);
  const [monthDays, setMonthDays] = useState<Record<string, CalendarDay[]>>({});
  const [loadingMonth, setLoadingMonth] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [played, setPlayed] = useState(() => adhanLogForYear(year));


  /* نحمّل شهر اليوم دائمًا لتظهر مواقيت هذا الأسبوع فور فتح الصفحة. */
  useEffect(() => {
    const month = new Date().getMonth() + 1;
    const key = `${year}-${month}`;
    if (monthDays[key]) return;
    let cancelled = false;
    fetchAdhanMonth(place.lat, place.lng, method, year, month)
      .then((days) => {
        if (!cancelled) setMonthDays((previous) => ({ ...previous, [key]: days }));
      })
      .catch(() => { /* تُعرض الرسالة عند فتح الشهر */ });
    return () => { cancelled = true; };
  }, [year, place.lat, place.lng, method, monthDays]);

  useEffect(() => {
    setPlayed(adhanLogForYear(year));
    const refresh = () => setPlayed(adhanLogForYear(year));
    window.addEventListener("thimar:adhan-log", refresh);
    return () => window.removeEventListener("thimar:adhan-log", refresh);
  }, [year]);

  useEffect(() => {
    if (openMonth === null) return;
    const key = `${year}-${openMonth}`;
    if (monthDays[key]) return;
    let cancelled = false;
    setLoadingMonth(openMonth);
    setError("");
    fetchAdhanMonth(place.lat, place.lng, method, year, openMonth)
      .then((days) => {
        if (!cancelled) setMonthDays((previous) => ({ ...previous, [key]: days }));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "تعذّر تحميل التقويم.");
      })
      .finally(() => {
        if (!cancelled) setLoadingMonth(null);
      });
    return () => { cancelled = true; };
  }, [openMonth, year, place.lat, place.lng, method, monthDays]);

  const savePlace = (city: string) => {
    try {
      localStorage.setItem("thimar.prayer.city", city);
      localStorage.removeItem("thimar.prayer.coords");
    } catch { /* ignore */ }
    const found = fallbackCities.find((item) => item.id === city) ?? fallbackCities[0];
    setCityId(city);
    setPlace({ city: found.name, lat: found.lat, lng: found.lng });
    setMonthDays({});
    window.dispatchEvent(new CustomEvent("thimar:settings"));
  };

  const locate = async () => {
    setLocating(true);
    setError("");
    try {
      const coords = await getCoordinates();
      try {
        localStorage.setItem("thimar.prayer.city", "auto");
        localStorage.setItem("thimar.prayer.coords", JSON.stringify(coords));
      } catch { /* ignore */ }
      setCityId("auto");
      setPlace({ city: "موقعك الحالي", ...coords });
      setMonthDays({});
      window.dispatchEvent(new CustomEvent("thimar:settings"));
    } catch {
      setError("تعذّر تحديد موقعك؛ اختر مدينة من القائمة.");
    } finally {
      setLocating(false);
    }
  };

  const week = useMemo(() => {
    const today = new Date();
    const days: CalendarDay[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const monthKey = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const found = (monthDays[monthKey] ?? []).find((day) => day.date === iso);
      if (found) days.push(found);
    }
    return days;
  }, [monthDays]);

  const prayerPrompt = useMemo(() => {
    const todayRow = week[week.length - 1];
    if (!todayRow) return "التزم بالصلاة في وقتها؛ الصلاة نور وحياة للقلب.";
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const upcoming = PRAYERS
      .map((prayer) => {
        const [h, m] = cleanTime(todayRow.timings[prayer.key]).split(":").map(Number);
        return { name: prayer.name, minutes: h * 60 + m };
      })
      .filter((item) => Number.isFinite(item.minutes) && item.minutes >= nowMinutes)
      .sort((a, b) => a.minutes - b.minutes)[0];
    if (!upcoming) return "أذّن العشاء اليوم — قم إلى الصلاة واختم يومك على طاعة.";
    const left = upcoming.minutes - nowMinutes;
    if (left <= 15) return `حان وقت صلاة ${upcoming.name} — قم إلى الصلاة الآن واترك ما بيدك.`;
    return `الصلاة القادمة: ${upcoming.name} بعد ${left} دقيقة — استعد واغتنم الوقت.`;
  }, [week]);

  return (
    <div className="page standalone-page adhan-log-page">
      <div className="page-head standalone-head">
        <div>
          <button type="button" className="ghost-button back-button" onClick={onBack}>
            <Icon name="arrow-right" size={16} /> الرئيسية
          </button>
          <h2>سجل الأذان</h2>
          <p className="muted">مواقيت الأذان لكل يوم في العام مع ما شُغّل على هذا الجهاز.</p>
        </div>
      </div>

      <div className="adhan-log-toolbar">
        <label>
          <span>الموقع</span>
          <select value={cityId} onChange={(event) => savePlace(event.target.value)}>
            <option value="auto">موقعي الحالي</option>
            {fallbackCities.map((city) => (
              <option key={city.id} value={city.id}>{city.name}</option>
            ))}
          </select>
        </label>
        <button type="button" className="ghost-button" onClick={() => void locate()} disabled={locating}>
          <Icon name="compass" size={16} /> {locating ? "جارٍ التحديد…" : "تحديد موقعي"}
        </button>
        <label>
          <span>طريقة الحساب</span>
          <select value={method} onChange={(event) => { setMethod(Number(event.target.value)); setMonthDays({}); }}>
            {prayerMethods.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="muted" style={{ marginTop: 4 }}>الموقع: {place.city} • سجل سنة {year} فقط</p>

      {week.length ? (
        <div className="adhan-week">
          <h3>هذا الأسبوع — من وقت الأذان</h3>
          <div className="adhan-week-list">
            {week.map((day) => (
              <div key={day.date} className="adhan-week-row">
                <strong>{day.date}</strong>
                {PRAYERS.map((prayer) => (
                  <span key={prayer.key} className="adhan-week-time">
                    <small>{prayer.name}</small>
                    {cleanTime(day.timings[prayer.key])}
                  </span>
                ))}
              </div>
            ))}
          </div>
          <p className="adhan-week-push">{prayerPrompt}</p>
        </div>
      ) : (
        <div className="adhan-week">
          <h3>هذا الأسبوع — من وقت الأذان</h3>
          <p className="muted">جارٍ تحميل مواقيت الأسبوع…</p>
        </div>
      )}
      {error ? <div className="error-box compact"><p>{error}</p></div> : null}

      <div className="adhan-months">
        {MONTHS.map((label, index) => {
          const month = index + 1;
          const key = `${year}-${month}`;
          const days = monthDays[key];
          const open = openMonth === month;
          return (
            <div key={label} className="adhan-month-card">
              <button
                type="button"
                className="adhan-month-head"
                onClick={() => setOpenMonth(open ? null : month)}
              >
                <strong>{label} {year}</strong>
                <span className="muted">{days ? `${days.length} يومًا` : "اضغط للعرض"}</span>
              </button>
              {open ? (
                loadingMonth === month && !days ? (
                  <div className="skeleton-list"><div className="skeleton-line" /><div className="skeleton-line" /></div>
                ) : days ? (
                  <div className="adhan-table-wrap">
                    <table className="adhan-table">
                      <thead>
                        <tr>
                          <th>التاريخ</th>
                          {PRAYERS.map((prayer) => <th key={prayer.key}>{prayer.name}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {days.map((day) => (
                          <tr key={day.date}>
                            <td>{day.date}{day.hijri ? ` — ${day.hijri}` : ""}</td>
                            {PRAYERS.map((prayer) => (
                              <td key={prayer.key}>{cleanTime(day.timings[prayer.key])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null
              ) : null}
            </div>
          );
        })}
      </div>

      <section className="adhan-played">
        <div className="adhan-played-head">
          <h3>الأذانات التي شُغّلت في {year} ({played.length})</h3>
          {played.length ? (
            <button
              type="button"
              className="ghost-button danger"
              onClick={() => { if (confirm("مسح سجل الأذانات المشغّلة؟")) { clearAdhanLog(); setPlayed([]); } }}
            >
              مسح
            </button>
          ) : null}
        </div>
        {played.length === 0 ? (
          <p className="muted">لم يُشغّل التطبيق أي أذان في هذه السنة بعد.</p>
        ) : (
          <ul className="adhan-played-list">
            {[...played].reverse().map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <span className="adhan-played-name">{entry.prayer}</span>
                <span className="muted">{entry.city}</span>
                <span className="muted">{new Date(entry.at).toLocaleString("ar-SA")}</span>
                <span className="muted">{entry.adhanName}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
