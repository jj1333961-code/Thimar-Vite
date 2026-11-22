import { useEffect, useMemo, useRef, useState } from "react";
import { countries, findCountry, flagOf } from "../data/countries";
import { ChevronIcon } from "./ui";

export default function CountrySelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (code: string) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const selected = findCountry(value) ?? countries[0];

  useEffect(() => {
    if (!open) return;
    function onDocumentDown(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocumentDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) => c.ar.includes(q) || c.code.toLowerCase().includes(q) || c.dial.includes(q),
    );
  }, [query]);

  return (
    <div className="combo" ref={boxRef}>
      <button
        type="button"
        id={id}
        className="input combo-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((prev) => !prev);
          setQuery("");
        }}
      >
        <span className="flag" aria-hidden="true">
          {flagOf(selected.code)}
        </span>
        <span className="combo-value">{selected.ar}</span>
        <span className="combo-dial" dir="ltr">
          {selected.dial}
        </span>
        <ChevronIcon />
      </button>

      {open && (
        <div className="combo-panel">
          <input
            autoFocus
            className="input combo-search"
            placeholder="ابحث عن دولتك…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="بحث عن دولة"
          />
          <ul className="combo-list" role="listbox" aria-label="الدول">
            {filtered.map((country) => (
              <li key={country.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={country.code === value}
                  className={
                    country.code === value
                      ? "combo-option is-selected"
                      : "combo-option"
                  }
                  onClick={() => {
                    onChange(country.code);
                    setOpen(false);
                  }}
                >
                  <span className="flag" aria-hidden="true">
                    {flagOf(country.code)}
                  </span>
                  <span className="combo-name">{country.ar}</span>
                  <span className="combo-dial" dir="ltr">
                    {country.dial}
                  </span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="combo-empty">لا توجد دولة بهذا الاسم</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
