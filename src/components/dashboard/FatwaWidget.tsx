import { useState } from "react";
import { fatwaCategories, fatwas } from "../../data/fatwas";
import { Icon } from "./ui";

export default function FatwaWidget() {
  const [category, setCategory] = useState<string>("الكل");
  const [openId, setOpenId] = useState<string | null>(null);

  const list = category === "الكل" ? fatwas : fatwas.filter((item) => item.category === category);

  return (
    <div className="fatwa-widget">
      <div className="fatwa-chips">
        {["الكل", ...fatwaCategories].map((item) => (
          <button
            key={item}
            type="button"
            className={`chip ${category === item ? "active" : ""}`}
            onClick={() => setCategory(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <ul className="fatwa-list">
        {list.map((fatwa) => {
          const open = openId === fatwa.id;
          return (
            <li key={fatwa.id} className={`fatwa-item ${open ? "open" : ""}`}>
              <button
                type="button"
                className="fatwa-question"
                onClick={() => setOpenId(open ? null : fatwa.id)}
                aria-expanded={open}
              >
                <span className="fatwa-category">{fatwa.category}</span>
                <strong>{fatwa.question}</strong>
                <Icon name={open ? "up" : "down"} size={16} />
              </button>
              {open ? (
                <div className="fatwa-answer">
                  <p>{fatwa.answer}</p>
                  {fatwa.evidence ? <small className="muted">{fatwa.evidence}</small> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="muted fatwa-note">
        هذه خلاصات ميسّرة في مسائل متكررة؛ وفي المسائل الخلافية يُرجَع إلى أهل العلم في بلدك.
      </p>
    </div>
  );
}
