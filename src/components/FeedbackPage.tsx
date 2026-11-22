import ComplaintForm from "./ComplaintForm";
import { BackIcon, BrandMark } from "./ui";

export default function FeedbackPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="feedback-shell">
      <div className="feedback-card">
        <button type="button" className="link-back" onClick={onBack}>
          <BackIcon />
          <span>العودة إلى تسجيل الدخول</span>
        </button>

        <div className="brand-row">
          <BrandMark size={42} />
          <div className="brand-row-text">
            <span className="wordmark">ثمار</span>
            <span className="brand-tag">حفظٌ يُثمر</span>
          </div>
        </div>

        <div className="form-head">
          <p className="eyebrow">صوتك يطوّرنا</p>
          <h1 className="form-title">الشكاوى والاقتراحات</h1>
          <p className="form-sub">
            تُرسل رسالتك مباشرة إلى المسؤول، ويستطيع الرد عليك عبر بيانات
            التواصل التي تكتبها.
          </p>
        </div>

        <ComplaintForm />
      </div>
    </div>
  );
}
