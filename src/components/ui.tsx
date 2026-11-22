import { useId, type ReactNode } from "react";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
        <path
          d="M32 11c8.4 6.2 12.6 13.4 12.6 20.4a12.6 12.6 0 0 1-25.2 0C19.4 24.4 23.6 17.2 32 11Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
        />
        <path
          d="M32 27v24"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        <path
          d="M32 39c-6.4-.9-9.6-4.2-10.6-9.6 6.4 0 9.6 3.2 10.6 9.6Zm0 6.6c6.4-.9 9.6-4.2 10.6-9.6-6.4 0-9.6 3.2-10.6 9.6Z"
          fill="currentColor"
          opacity="0.9"
        />
      </svg>
    </span>
  );
}

export function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.8 20c.4-3.7 3.5-5.7 7.2-5.7s6.8 2 7.2 5.7" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <rect x="4.5" y="10" width="15" height="10" rx="2.8" />
      <path d="M8 10V7.6a4 4 0 0 1 8 0V10" />
      <path d="M12 14v2.4" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <path d="M2.8 12S6 6.5 12 6.5 21.2 12 21.2 12 18 17.5 12 17.5 2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.7c6 0 9.2 5.5 9.2 5.5a16 16 0 0 1-2.7 3.3" />
      <path d="M6.4 8.3A15.6 15.6 0 0 0 2.8 11.2S6 16.7 12 16.7c1.2 0 2.3-.2 3.3-.6" />
    </svg>
  );
}

export function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <rect x="3.2" y="5.5" width="17.6" height="13" rx="2.6" />
      <path d="m4.5 8 7.5 5 7.5-5" />
    </svg>
  );
}

export function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <path d="M7.3 3.8h2.4l1.5 3.7-2 1.4a11 11 0 0 0 5.9 5.9l1.4-2 3.7 1.5v2.4a2.5 2.5 0 0 1-2.7 2.5C10.4 18.6 5.4 13.6 4.8 6.5A2.5 2.5 0 0 1 7.3 3.8Z" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="field-error">{error}</p>
      ) : hint ? (
        <p className="field-hint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Segmented({
  value,
  onChange,
  yes = "نعم",
  no = "لا",
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  yes?: string;
  no?: string;
}) {
  return (
    <div className="segmented" role="group">
      <button
        type="button"
        className={value ? "segment is-on" : "segment"}
        aria-pressed={value}
        onClick={() => onChange(true)}
      >
        {yes}
      </button>
      <button
        type="button"
        className={!value ? "segment is-on" : "segment"}
        aria-pressed={!value}
        onClick={() => onChange(false)}
      >
        {no}
      </button>
    </div>
  );
}

export function GeometricPattern() {
  const raw = useId();
  const id = `geo-${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      className="geo"
      viewBox="0 0 400 400"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <pattern id={id} width="72" height="72" patternUnits="userSpaceOnUse">
          <path
            d="M36 4 68 36 36 68 4 36Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.9"
          />
          <circle
            cx="36"
            cy="36"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.7"
          />
          <path d="M4 36h64M36 4v64" stroke="currentColor" strokeWidth="0.4" />
        </pattern>
      </defs>
      <rect width="400" height="400" fill={`url(#${id})`} />
    </svg>
  );
}
