/* ملاحظات المستخدم على الآيات — محفوظة على الجهاز بمفتاح الرقم العام للآية. */

export const NOTES_KEY = "thimar.notes";

export type AyahNoteMap = Record<string, string>;

export function readAyahNotes(): AyahNoteMap {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const map: AyahNoteMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

export function noteOf(global: number): string {
  return readAyahNotes()[String(global)] ?? "";
}

/** يحفظ ملاحظة الآية، ويمسحها إن كانت فارغة. */
export function saveAyahNote(global: number, note: string): void {
  const map = readAyahNotes();
  const key = String(global);
  const trimmed = note.trim();
  if (trimmed) map[key] = trimmed;
  else delete map[key];
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(map));
  } catch {
    /* تجاهل امتلاك التخزين. */
  }
}

export function deleteAyahNote(global: number): void {
  const map = readAyahNotes();
  delete map[String(global)];
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(map));
  } catch {
    /* تجاهل */
  }
}

export function hasAyahNote(global: number): boolean {
  return Boolean(readAyahNotes()[String(global)]?.trim());
}
