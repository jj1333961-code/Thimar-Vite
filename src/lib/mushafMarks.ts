/* علامات الآيات المرجعية (Bookmark) المحفوظة على الجهاز. */

export type MushafMark = {
  surah: number;
  ayah: number;
  page: number;
  at: number;
  text?: string;
};

const KEY = "thimar.mushaf.marks.v1";
/** فهرس علامات المراجعة الذي تعرضه صفحة القرآن (بالرقم العام للآية). */
const REVIEW_KEY = "thimar.reviewMarks";

/** يُضيف الرقم العام أو يزيله من قائمة علامات المراجعة في صفحة القرآن. */
export function setReviewMark(global: number, add: boolean): void {
  try {
    const raw = JSON.parse(localStorage.getItem(REVIEW_KEY) || "[]") as unknown;
    const list = Array.isArray(raw) ? raw.map(Number).filter(Number.isFinite) : [];
    const next = add
      ? list.includes(global)
        ? list
        : [...list, global]
      : list.filter((value) => value !== global);
    localStorage.setItem(REVIEW_KEY, JSON.stringify(next));
  } catch {
    /* تجاهل التخزين غير المتاح. */
  }
}

export function readMarks(): MushafMark[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MushafMark[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((mark) => mark && mark.surah >= 1 && mark.ayah >= 1);
  } catch {
    return [];
  }
}

export function isMarked(surah: number, ayah: number): boolean {
  return readMarks().some((mark) => mark.surah === surah && mark.ayah === ayah);
}

/** يضيف العلامة أو يزيلها، ويعيد الحالة بعد التغيير. */
export function deleteMark(surah: number, ayah: number): void {
  const marks = readMarks().filter((mark) => !(mark.surah === surah && mark.ayah === ayah));
  write(marks);
}

export function clearMarks(): void {
  write([]);
}

export function toggleMark(mark: MushafMark): boolean {
  const marks = readMarks();
  const index = marks.findIndex((item) => item.surah === mark.surah && item.ayah === mark.ayah);
  if (index >= 0) {
    marks.splice(index, 1);
    write(marks);
    return false;
  }
  marks.unshift(mark);
  write(marks.slice(0, 500));
  return true;
}

function write(marks: MushafMark[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(marks));
  } catch {
    /* تجاهل امتلاء التخزين. */
  }
}
