export type Qiraah = { id: string; name: string; narrators: string };

export const qiraat: Qiraah[] = [
  { id: "nafi", name: "نافع المدني", narrators: "ورش · قالون" },
  { id: "ibn-kathir", name: "ابن كثير المكي", narrators: "البزي · قنبل" },
  { id: "abu-amr", name: "أبو عمرو البصري", narrators: "الدوري · السوسي" },
  { id: "ibn-amir", name: "ابن عامر الشامي", narrators: "هشام · ابن ذكوان" },
  { id: "asim", name: "عاصم الكوفي", narrators: "حفص · شعبة" },
  { id: "hamza", name: "حمزة الكوفي", narrators: "خلف · خلاد" },
  { id: "kisai", name: "الكسائي الكوفي", narrators: "أبو الحارث · الدوري" },
  { id: "abu-jafar", name: "أبو جعفر المدني", narrators: "ابن وردان · ابن جماز" },
  { id: "yaqub", name: "يعقوب الحضرمي", narrators: "رويس · روح" },
  { id: "khalaf", name: "خلف العاشر", narrators: "إسحاق · إدريس" },
];

export type Teacher = {
  id: string;
  name: string;
  city: string;
  ijazah: string;
  qiraat: string[];
  juz: number;
  rating: number;
  students: number;
};

export const approvedTeachers: Teacher[] = [
  {
    id: "t1",
    name: "الشيخ عبد الرحمن الحسيني",
    city: "المدينة المنورة",
    ijazah: "إجازة برواية حفص عن عاصم",
    qiraat: ["عاصم الكوفي"],
    juz: 30,
    rating: 4.9,
    students: 68,
  },
  {
    id: "t2",
    name: "الشيخة مريم السالم",
    city: "الرياض",
    ijazah: "إجازة في القراءات العشر",
    qiraat: ["عاصم الكوفي", "نافع المدني", "ابن كثير المكي"],
    juz: 30,
    rating: 4.8,
    students: 54,
  },
  {
    id: "t3",
    name: "الشيخ يوسف العمري",
    city: "عمّان",
    ijazah: "إجازة برواية ورش",
    qiraat: ["نافع المدني"],
    juz: 20,
    rating: 4.7,
    students: 41,
  },
  {
    id: "t4",
    name: "الشيخ أحمد بن صالح",
    city: "القاهرة",
    ijazah: "إجازة برواية شعبة",
    qiraat: ["عاصم الكوفي", "حمزة الكوفي"],
    juz: 30,
    rating: 4.6,
    students: 37,
  },
  {
    id: "t5",
    name: "الشيخة نورة القحطاني",
    city: "الدمام",
    ijazah: "إجازة في القرآن وتحفة الأطفال",
    qiraat: ["عاصم الكوفي"],
    juz: 15,
    rating: 4.9,
    students: 29,
  },
  {
    id: "t6",
    name: "الشيخ خالد التميمي",
    city: "الكويت",
    ijazah: "إجازة بالقراءات العشر الصغرى",
    qiraat: ["ابن عامر الشامي", "الكسائي الكوفي", "أبو عمرو البصري"],
    juz: 30,
    rating: 4.8,
    students: 62,
  },
];
