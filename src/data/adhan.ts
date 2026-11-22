export type AdhanOption = {
  id: string;
  name: string;
  description: string;
  url: string;
};

export const adhanOptions: AdhanOption[] = [
  {
    id: "adhan-1",
    name: "أذان ١ — هادئ",
    description: "",
    url: "/adhan/azan1.mp3",
  },
  {
    id: "adhan-2",
    name: "أذان ٢ — واضح",
    description: "أذان بصوت واضح ومتوسط المدة.",
    url: "/adhan/azan2.mp3",
  },
  {
    id: "adhan-3",
    name: "أذان ٣ — طويل",
    description: "أذان كامل بصوت ممتد.",
    url: "/adhan/azan3.mp3",
  },
  {
    id: "adhan-imadi",
    name: "أذان أحمد العمادي",
    description: "صوت مؤثر من تسجيلات المسجد النبوي.",
    url: "/adhan/imadi.mp3",
  },
  {
    id: "adhan-hamathani",
    name: "أذان ماجد الحمذاني",
    description: "أذان هادئ بصوت واضح.",
    url: "/adhan/hamathani.mp3",
  },
  {
    id: "adhan-afasy-fajr",
    name: "أذان الفجر — مشاري العفاسي",
    description: "أذان الفجر بصوت الشيخ مشاري راشد العفاسي.",
    url: "/adhan/afasy-fajr.mp3",
  },
  ...[
    { n: 4, title: "أذان ٤ — نغمة شامية" },
    { n: 5, title: "أذان ٥ — نغمة حجازية" },
    { n: 6, title: "أذان ٦ — نغمة مصرية" },
    { n: 7, title: "أذان ٧ — نغمة مغاربية" },
    { n: 8, title: "أذان ٨ — نغمة خليجية" },
    { n: 9, title: "أذان ٩ — نغمة مدنية" },
    { n: 10, title: "أذان ١٠ — نغمة مكية" },
    { n: 11, title: "أذان ١١ — نغمة هادئة" },
    { n: 12, title: "أذان ١٢ — نغمة طويلة" },
  ].map((item) => ({
    id: `adhan-country-${item.n}`,
    name: item.title,
    description: "تسجيل من مساجد العالم العربي — اختر النغمة الأنسب لك.",
    url: `https://www.islamcan.com/audio/adhan/azan${item.n}.mp3`,
  })),
];

export function getAdhan(id: string): AdhanOption {
  return adhanOptions.find((item) => item.id === id) ?? adhanOptions[0];
}
