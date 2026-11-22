import { useEffect, useRef, useState } from "react";
import { getCoordinates, qiblaBearing } from "../../lib/islamic";
import { playNotificationSound } from "../../lib/sound";
import { Icon } from "./ui";

export default function QiblaWidget() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [place, setPlace] = useState("جارٍ تحديد الموقع…");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [heading, setHeading] = useState(0); // device heading (0-360)
  const [, setOrientationSupported] = useState(false);
  const locatedRef = useRef(false);

  const locate = () => {
    setLoading(true);
    setError("");
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setError("تعذّر تحديد موقعك. تأكّد من تشغيل خدمة الموقع والاتصال بالإنترنت ثم أعد المحاولة.");
      setLoading(false);
    }, 15000);
    getCoordinates()
      .then((position) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        setCoords(position);
        setPlace("موقعك الحالي");
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        setError("لم نتمكن من قراءة موقعك. اسمح بالوصول إلى الموقع ثم أعد المحاولة.");
      })
      .finally(() => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
        }
        setLoading(false);
      });
  };

  useEffect(() => {
    if (locatedRef.current) return;
    locatedRef.current = true;
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // device orientation listener (real-time)
  useEffect(() => {
    const handleOrientation = (event: DeviceOrientationEvent) => {
      let h: number | null = null;
      // iOS provides webkitCompassHeading
      const w = event as unknown as { webkitCompassHeading?: number };
      if (typeof w.webkitCompassHeading === "number") {
        h = w.webkitCompassHeading;
      } else if (typeof event.alpha === "number") {
        // Android: alpha is angle from north (clockwise) when absolute
        h = 360 - event.alpha;
      }
      if (h !== null) {
        setHeading(h);
        setOrientationSupported(true);
      }
    };
    // request permission on iOS 13+
    const start = async () => {
      try {
        const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
        if (DOE && typeof DOE.requestPermission === "function") {
          const res = await DOE.requestPermission();
          if (res !== "granted") return;
        }
        window.addEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
        window.addEventListener("deviceorientation", handleOrientation as EventListener, true);
      } catch {
        // ignore
      }
    };
    start();
    return () => {
      window.removeEventListener("deviceorientationabsolute", handleOrientation as EventListener, true);
      window.removeEventListener("deviceorientation", handleOrientation as EventListener, true);
    };
  }, []);

  const bearing = coords ? qiblaBearing(coords.lat, coords.lng) : 0;
  // needle rotation relative to device heading
  const needleRotation = ((bearing - heading) + 360) % 360;
  const aligned = Math.min(needleRotation, 360 - needleRotation) < 6;
  const wasAlignedRef = useRef(false);

  // نغمة عند الوصول إلى اتجاه القبلة الصحيح (مرة واحدة لكل محاذاة).
  useEffect(() => {
    if (aligned && !wasAlignedRef.current) playNotificationSound("success");
    wasAlignedRef.current = aligned;
  }, [aligned]);

  return (
    <div className="qibla-widget">
      <div className="qibla-head">
        <div>
          <h4>اتجاه القبلة</h4>
          <p>{place}</p>
        </div>
        <button type="button" className="primary-button" onClick={locate} disabled={loading}>
          <Icon name="compass" size={16} /> {loading ? "جارٍ التحديد…" : "تحديد موقعي"}
        </button>
      </div>

      <div className="qibla-body">
        <div className={`compass-large${aligned ? " aligned" : ""}`}>
          <svg className="qibla-compass" viewBox="0 0 220 220" role="img" aria-label="بوصلة القبلة: السهم بالكعبة يشير إلى اتجاه القبلة">
            <defs>
              <linearGradient id="qiblaNeedle" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#0f5f4e" />
                <stop offset="100%" stopColor="#1a8f74" />
              </linearGradient>
            </defs>
            <circle cx="110" cy="110" r="106" className="qibla-face" />
            <circle cx="110" cy="110" r="92" className="qibla-face-inner" />
            {Array.from({ length: 72 }).map((_, index) => {
              const major = index % 6 === 0;
              return (
                <line
                  key={index}
                  x1="110"
                  y1={major ? 8 : 12}
                  x2="110"
                  y2={major ? 20 : 17}
                  className={major ? "qibla-tick major" : "qibla-tick"}
                  transform={`rotate(${index * 5} 110 110)`}
                />
              );
            })}
            <text x="110" y="30" className="qibla-dir-text north">ش</text>
            <text x="190" y="114" className="qibla-dir-text">ق</text>
            <text x="110" y="192" className="qibla-dir-text">ج</text>
            <text x="30" y="114" className="qibla-dir-text">غ</text>
            <g className="qibla-needle" style={{ transform: `rotate(${needleRotation}deg)`, transformOrigin: "110px 110px" }}>
              <path d="M110 66 L121 96 L110 88 L99 96 Z" className="qibla-needle-head" />
              <rect x="107" y="90" width="6" height="38" rx="3" className="qibla-needle-shaft" />
              <path d="M110 184 L104 152 L116 152 Z" className="qibla-needle-tail" />
              {/* الكعبة في رأس السهم، والسهم يشير إليها */}
              <g className="qibla-kaaba" transform="translate(110 44)">
                <path d="M-14 0 L0 -9 L14 0 L14 18 L0 27 L-14 18 Z" className="kaaba-body" />
                <path d="M-14 0 L0 9 L14 0" className="kaaba-top" />
                <rect x="-14" y="3" width="28" height="3.5" className="kaaba-band" />
                <rect x="1" y="11" width="6" height="10" rx="1" className="kaaba-door" />
              </g>
            </g>
            <circle cx="110" cy="110" r="10" className="qibla-hub" />
            <circle cx="110" cy="110" r="4" className="qibla-hub-dot" />
          </svg>
        </div>
      </div>

      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}
