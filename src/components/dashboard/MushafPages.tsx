import MushafPagesText from "./MushafPagesText";

/*
 * مصحف التجويد الملوّن (نسخة الموسوعة القرآنية) هو نسخة المصحف المعتمدة في
 * التطبيق: صفحة بيضاء بإطار رفيع، خط عثماني، أرقام آيات في زخارف خضراء،
 * فاصل ذهبي ورقم صفحة في زخرفته. لا توجد صفحات مصوّرة قديمة بعد الآن.
 */
export default function MushafPages({
  onClose,
  initialPage,
  initialHighlight,
}: {
  onClose: () => void;
  initialPage?: number;
  initialHighlight?: number | null;
}) {
  return <MushafPagesText onClose={onClose} initialPage={initialPage} initialHighlight={initialHighlight} />;
}
