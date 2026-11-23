import React from "react";

const paths: Record<string, React.ReactNode> = {
  home: <><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1Z" /></>,
  chat: <><path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-5.5A8 8 0 0 1 13 4a8 8 0 0 1 8 8Z" /></>,
  bell: <><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  clipboard: <><path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z" /><path d="M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2" /></>,
  chart: <><path d="M4 20h16" /><path d="M7 16v-6M12 16V8M17 16v-10" /></>,
  sparkles: <><path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" /><path d="M5 19l1 3 1-3 3-1-3-1-1-3-1 3-3 1Z" /></>,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  book: <><path d="M4 4h10a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H4Z" /><path d="M4 4v13a3 3 0 0 0 3 3h11" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15 9-2 6-6 2 2-6Z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  play: <><path d="M6 4l13 8-13 8Z" /></>,
  pause: <><path d="M6 4h4v16H6ZM14 4h4v16h-4Z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  send: <><path d="M22 2 11 13M22 2 15 22l-4-9-9-4 20-7Z" /></>,
  mic: <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z" /><path d="M19 10a7 7 0 0 1-14 0M12 17v4M8 21h8" /></>,
  video: <><path d="M23 7l-7 5 7 5Z" /><rect x="1" y="5" width="15" height="14" rx="2" /></>,
  phone: <><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.9 19.9 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.9 19.9 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.7 3.5a2 2 0 0 1-.6 1.8L8 10.2a16 16 0 0 0 6 6l1.2-1.3a2 2 0 0 1 1.8-.6l3.5.7A2 2 0 0 1 22 16.9Z" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M9 13h6M9 17h4" /></>,
  check: <><path d="m5 12 5 5L20 7" /></>,
  star: <><path d="m12 2 3 7 7 .5-5.3 4.5 1.6 7-6.3-3.8L5.7 21l1.6-7L2 9.5 9 9Z" /></>,
  up: <><path d="m6 15 6-6 6 6" /></>,
  down: <><path d="m6 9 6 6 6-6" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
  palette: <><path d="M12 3a9 9 0 0 0 0 18h1a3 3 0 0 0 0-6h-1a3 3 0 0 1 0-6h4a3 3 0 0 0 0-6Z" /><circle cx="7" cy="10" r="1" /><circle cx="9" cy="6" r="1" /><circle cx="14" cy="6" r="1" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></>,
  x: <><path d="m6 6 12 12M18 6 6 18" /></>,
  moon: <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  "eye-off": <><path d="M3 3l18 18M10.6 10.6a3 3 0 1 0 4.2 4.2M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.2 3.2M6.1 6.1A18.5 18.5 0 0 0 2 12s3.5 8 10 8c1.3 0 2.5-.3 3.6-.8" /></>,
  camera: <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" /><circle cx="12" cy="13" r="4" /></>,
  group: <><path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5" /></>,
  trend: <><path d="M3 17l6-6 4 4 8-8M17 7h4v4" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  volume: <><path d="M11 5 6 9H3v6h3l5 4Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initial = name.trim().charAt(0) || "؟";
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initial}
    </span>
  );
}

export function Stars({ value }: { value: number }) {
  const rounded = Math.round(value);
  return (
    <span className="stars">
      {Array.from({ length: 5 }, (_, index) => (
        <span key={index} className={index < rounded ? "star filled" : "star"}>
          ★
        </span>
      ))}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`section-card ${className}`}>
      {(title || subtitle || action) && (
        <header className="section-head">
          <div>
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
  onClick,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: IconName;
  tone?: "default" | "success" | "warning" | "danger";
  onClick?: () => void;
}) {
  return (
    <button className={`stat-card stat-${tone}`} onClick={onClick} type="button">
      <div className="stat-icon">
        <Icon name={icon} size={20} />
      </div>
      <div className="stat-body">
        <span className="stat-value">{value}</span>
        <span className="stat-label">{label}</span>
        {hint ? <span className="stat-hint">{hint}</span> : null}
      </div>
    </button>
  );
}


/** Lightweight inline brand mark used by the shared dashboard shell. */
export function BrandMark({ size = 42 }: { size?: number }) {
  return (
    <span
      className="brand-mark"
      style={{ display: "grid", placeItems: "center", width: size, height: size, flex: "0 0 auto" }}
      aria-hidden="true"
    >
      <svg width={size * 0.68} height={size * 0.68} viewBox="0 0 32 32" fill="none">
        <path d="M16 27V8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M16 16C8.5 16 5 12.5 5 7c7.5 0 11 3.5 11 9Z" fill="currentColor" opacity=".9" />
        <path d="M16 21c7.5 0 11-3.5 11-9-7.5 0-11 3.5-11 9Z" fill="#C49A42" />
        <path d="M10 27h12" stroke="#C49A42" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}
