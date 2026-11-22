import { useState, type FormEvent } from "react";
import { addComplaint, accountTypeLabel, type Account } from "../lib/auth";
import { Field } from "./ui";

const subjects = ["شكوى", "اقتراح", "مشكلة تقنية", "ملاحظة على المحتوى"];

export default function ComplaintForm({
  account,
  onSent,
}: {
  account?: Account | null;
  onSent?: () => void;
}) {
  const [subject, setSubject] = useState(subjects[0]);
  const [body, setBody] = useState("");
  const [name, setName] = useState(account?.fullName ?? "");
  const [contact, setContact] = useState(account?.email ?? "");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account && name.trim().length < 3) {
      setError("اكتب اسمك حتى نتمكن من الرد عليك.");
      return;
    }
    if (body.trim().length < 10) {
      setError("اكتب تفاصيل أكثر (١٠ أحرف على الأقل).");
      return;
    }
    addComplaint({
      name: account?.fullName ?? name,
      contact: contact || account?.email || account?.phone || "",
      role: account ? accountTypeLabel(account.type) : "زائر",
      subject,
      body,
      accountId: account?.id ?? null,
    });
    setSent(true);
    setBody("");
    setError("");
    onSent?.();
  }

  if (sent) {
    return (
      <div className="alert alert-soft">
        وصلت رسالتك إلى المسؤول، شكرًا لك. يمكنك متابعة الرد من لوحة المسؤول
        لاحقًا.
        <button
          type="button"
          className="link-mini"
          onClick={() => setSent(false)}
        >
          إرسال رسالة أخرى
        </button>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate>
      <Field label="نوع الرسالة" htmlFor="cmp-subject">
        <select
          id="cmp-subject"
          className="input"
          value={subject}
          onChange={(event) => {
            setSubject(event.target.value);
            setError("");
          }}
        >
          {subjects.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </Field>

      {!account && (
        <div className="form-grid">
          <Field label="الاسم" htmlFor="cmp-name">
            <input
              id="cmp-name"
              className="input"
              placeholder="اسمك"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError("");
              }}
            />
          </Field>
          <Field label="البريد أو الهاتف" htmlFor="cmp-contact">
            <input
              id="cmp-contact"
              className="input"
              dir="ltr"
              placeholder="للتواصل (اختياري)"
              value={contact}
              onChange={(event) => setContact(event.target.value)}
            />
          </Field>
        </div>
      )}

      <Field label="التفاصيل" htmlFor="cmp-body" error={error}>
        <textarea
          id="cmp-body"
          className="input textarea"
          rows={4}
          placeholder="اكتب شكواك أو اقتراحك بوضوح…"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            setError("");
          }}
        />
      </Field>

      <button type="submit" className="btn btn-primary">
        إرسال إلى المسؤول
      </button>
    </form>
  );
}
