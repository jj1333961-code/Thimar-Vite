export type AdhanOption = {
  id: string;
  /** الاسم المعروض في القوائم. */
  name: string;
  /** اسم المؤذن إن كان معروفًا (يُعرض صراحة للمستخدم). */
  muezzin?: string;
  description: string;
  url: string;
  source?: "local" | "cdn";
};

/**
 * أصوات الأذان: تسجيلات محلية مضمّنة + تسجيلات لمؤذنين معروفين من
 * مجموعة Kiwifu/adhan-mp3 المفتوحة (تُقدَّم عبر jsDelivr وتُخزَّن للعمل دون إنترنت).
 * اسم المؤذن يظهر لكل صوت حتى يختار المستخدم صوته المفضّل بوعي.
 */
export const adhanOptions: AdhanOption[] = [
  {
    "id": "adhan-1",
    "name": "أذان هادئ",
    "muezzin": "",
    "description": "تسجيل هادئ قصير مناسب للنوم والاستماع.",
    "url": "/adhan/azan1.mp3",
    "source": "local"
  },
  {
    "id": "adhan-2",
    "name": "أذان واضح",
    "muezzin": "",
    "description": "أذان بصوت واضح ومتوسط المدة.",
    "url": "/adhan/azan2.mp3",
    "source": "local"
  },
  {
    "id": "adhan-3",
    "name": "أذان كامل",
    "muezzin": "",
    "description": "أذان كامل بصوت ممتد.",
    "url": "/adhan/azan3.mp3",
    "source": "local"
  },
  {
    "id": "adhan-imadi",
    "name": "أحمد العمادي",
    "muezzin": "أحمد العمادي",
    "description": "صوت مؤثر من تسجيلات المسجد النبوي.",
    "url": "/adhan/imadi.mp3",
    "source": "local"
  },
  {
    "id": "adhan-hamathani",
    "name": "ماجد الحمذاني",
    "muezzin": "ماجد الحمذاني",
    "description": "أذان هادئ بصوت واضح.",
    "url": "/adhan/hamathani.mp3",
    "source": "local"
  },
  {
    "id": "adhan-afasy-fajr",
    "name": "مشاري العفاسي — أذان الفجر",
    "muezzin": "مشاري راشد العفاسي",
    "description": "أذان الفجر بصوت الشيخ مشاري راشد العفاسي.",
    "url": "/adhan/afasy-fajr.mp3",
    "source": "local"
  },
  {
    "id": "adhan-muezzin-1",
    "name": "علي بن أحمد ملا",
    "muezzin": "علي بن أحمد ملا",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ali_Ibn_Ahmad_Mala_-_HQ_(%D8%B9%D9%84%D9%8A_%D8%A8%D9%86_%D8%A3%D8%AD%D9%85%D8%AF_%D9%85%D9%84%D8%A7).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-2",
    "name": "عبد الباسط عبد الصمد",
    "muezzin": "عبد الباسط عبد الصمد",
    "description": "أذان كامل — مصر",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abdulbasit_Abdusamad_1_-_Egypt_(%D8%B9%D8%A8%D8%AF_%D8%A7%D9%84%D8%A8%D8%A7%D8%B3%D8%B7_%D8%B9%D8%A8%D8%AF_%D8%A7%D9%84%D8%B5%D9%85%D8%AF_-_%D9%85%D8%B5%D8%B1).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-3",
    "name": "مشاري العفاسي",
    "muezzin": "مشاري العفاسي",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Mishary_Al_Afasy_-_HQ_(%D9%85%D8%B4%D8%A7%D8%B1%D9%8A_%D8%A7%D9%84%D8%B9%D9%81%D8%A7%D8%B3%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-5",
    "name": "محمد خليل رمل",
    "muezzin": "محمد خليل رمل",
    "description": "أذان كامل — الحرم المكي",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Muhammad_Khaleel_Raml_-_Al_Haram_Al_Maki_(%D9%85%D8%AD%D9%85%D8%AF_%D8%AE%D9%84%D9%8A%D9%84_%D8%B1%D9%85%D9%84_-_%D8%A7%D9%84%D8%AD%D8%B1%D9%85_%D8%A7%D9%84%D9%85%D9%83%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-6",
    "name": "أحمد النفيس",
    "muezzin": "أحمد النفيس",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmad_Al_Nafees_(%D8%A3%D8%AD%D9%85%D8%AF_%D8%A7%D9%84%D9%86%D9%81%D9%8A%D8%B3).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-7",
    "name": "منصور الزهراني",
    "muezzin": "منصور الزهراني",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Mansur_Al_Zahrane_(%D9%85%D9%86%D8%B5%D9%88%D8%B1_%D8%A7%D9%84%D8%B2%D9%87%D8%B1%D8%A7%D9%86%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-8",
    "name": "عبدالمجيد السريحي",
    "muezzin": "عبدالمجيد السريحي",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abdul_Majid_Al_Surehi_1_(%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D9%85%D8%AC%D9%8A%D8%AF_%D8%A7%D9%84%D8%B3%D8%B1%D9%8A%D8%AD%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-9",
    "name": "أبو العينين شعيشع",
    "muezzin": "أبو العينين شعيشع",
    "description": "أذان كامل — القاهرة",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abul_Ainain_Shuaisha_-_Cairo_(%D8%A3%D8%A8%D9%88_%D8%A7%D9%84%D8%B9%D9%8A%D9%86%D9%8A%D9%86_%D8%B4%D8%B9%D9%8A%D8%B4%D8%B9_-_%D8%A7%D9%84%D9%82%D8%A7%D9%87%D8%B1%D8%A9).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-10",
    "name": "محمد رفعت",
    "muezzin": "محمد رفعت",
    "description": "أذان كامل — القاهرة",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Muhammad_Refaat_-_Cairo_(%D9%85%D8%AD%D9%85%D8%AF_%D8%B1%D9%81%D8%B9%D8%AA_-_%D8%A7%D9%84%D9%82%D8%A7%D9%87%D8%B1%D8%A9).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-11",
    "name": "أحمد نعينع",
    "muezzin": "أحمد نعينع",
    "description": "أذان كامل — مصر",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmed_Nuinaa_1_-_Egypt_(%D8%A3%D8%AD%D9%85%D8%AF_%D9%86%D8%B9%D9%8A%D9%86%D8%B9_-_%D9%85%D8%B5%D8%B1).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-12",
    "name": "محمد صديق المنشاوي",
    "muezzin": "محمد صديق المنشاوي",
    "description": "أذان كامل — أفغانستان",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Mohamed_Siddiq_El-Minshawi_-_Afghanistan_(%D9%85%D8%AD%D9%85%D8%AF_%D8%B5%D8%AF%D9%8A%D9%82_%D8%A7%D9%84%D9%85%D9%86%D8%B4%D8%A7%D9%88%D9%8A_-_%D8%A3%D9%81%D8%BA%D8%A7%D9%86%D8%B3%D8%AA%D8%A7%D9%86).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-13",
    "name": "ناصر القطامي",
    "muezzin": "ناصر القطامي",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Nasser_Al_Qatami_-_HQ_(%D9%86%D8%A7%D8%B5%D8%B1_%D8%A7%D9%84%D9%82%D8%B7%D8%A7%D9%85%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-14",
    "name": "عادل مالك عبدالله المصري",
    "muezzin": "عادل مالك عبدالله المصري",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Adal_Malek_Abdulah_Al_Massre_(%D8%B9%D8%A7%D8%AF%D9%84_%D9%85%D8%A7%D9%84%D9%83_%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D9%84%D9%87_%D8%A7%D9%84%D9%85%D8%B5%D8%B1%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-15",
    "name": "أحمد عامر محمد",
    "muezzin": "أحمد عامر محمد",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmad_Aamer_Muhammad_(%D8%A3%D8%AD%D9%85%D8%AF_%D8%B9%D8%A7%D9%85%D8%B1_%D9%85%D8%AD%D9%85%D8%AF).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-16",
    "name": "أحمد العاني",
    "muezzin": "أحمد العاني",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmad_Al_Aane_(%D8%A3%D8%AD%D9%85%D8%AF_%D8%A7%D9%84%D8%B9%D8%A7%D9%86%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-17",
    "name": "أحمد البطل",
    "muezzin": "أحمد البطل",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmad_Al_Batal_(%D8%A3%D8%AD%D9%85%D8%AF_%D8%A7%D9%84%D8%A8%D8%B7%D9%84).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-18",
    "name": "أحمد الحراسيس",
    "muezzin": "أحمد الحراسيس",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmad_Al_Harasses_(%D8%A3%D8%AD%D9%85%D8%AF_%D8%A7%D9%84%D8%AD%D8%B1%D8%A7%D8%B3%D9%8A%D8%B3).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-19",
    "name": "أحمد الطرابلسي",
    "muezzin": "أحمد الطرابلسي",
    "description": "أذان الفجر — فجر الكويت",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmd_At-Trablsy_-_Fajr_Kuwait_(%D8%A3%D8%AD%D9%85%D8%AF_%D8%A7%D9%84%D8%B7%D8%B1%D8%A7%D8%A8%D9%84%D8%B3%D9%8A_-_%D9%81%D8%AC%D8%B1_%D8%A7%D9%84%D9%83%D9%88%D9%8A%D8%AA).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-20",
    "name": "أحمد الحداد",
    "muezzin": "أحمد الحداد",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmed_Al-Haddad_(%D8%A3%D8%AD%D9%85%D8%AF_%D8%A7%D9%84%D8%AD%D8%AF%D8%A7%D8%AF).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-21",
    "name": "أحمد الكردي",
    "muezzin": "أحمد الكردي",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmed_El_Kourdi_(%D8%A3%D8%AD%D9%85%D8%AF_%D8%A7%D9%84%D9%83%D8%B1%D8%AF%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-22",
    "name": "عبدالله الذهبي",
    "muezzin": "عبدالله الذهبي",
    "description": "أذان كامل — مصر",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abdulah_Al_Dahbe_-_Egypt_(%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D9%84%D9%87_%D8%A7%D9%84%D8%B0%D9%87%D8%A8%D9%8A_-_%D9%85%D8%B5%D8%B1).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-23",
    "name": "عبدالله المكناوي",
    "muezzin": "عبدالله المكناوي",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abdulah_Al_Maknawe_(%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D9%84%D9%87_%D8%A7%D9%84%D9%85%D9%83%D9%86%D8%A7%D9%88%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-24",
    "name": "عبدالله الصباوي",
    "muezzin": "عبدالله الصباوي",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abdulah_Al_Sabaawe_(%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D9%84%D9%87_%D8%A7%D9%84%D8%B5%D8%A8%D8%A7%D9%88%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-25",
    "name": "عبد الرزاق صالح",
    "muezzin": "عبد الرزاق صالح",
    "description": "أذان كامل — لبنان",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abd_Alrazaq_Saleh_-_Lebanon_(%D8%B9%D8%A8%D8%AF_%D8%A7%D9%84%D8%B1%D8%B2%D8%A7%D9%82_%D8%B5%D8%A7%D9%84%D8%AD_-_%D9%84%D8%A8%D9%86%D8%A7%D9%86).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-26",
    "name": "عبد المنعم عبد المبدي",
    "muezzin": "عبد المنعم عبد المبدي",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abdel_Moneim_Abdel_Mobdi_(%D8%B9%D8%A8%D8%AF_%D8%A7%D9%84%D9%85%D9%86%D8%B9%D9%85_%D8%B9%D8%A8%D8%AF_%D8%A7%D9%84%D9%85%D8%A8%D8%AF%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-27",
    "name": "عبد الكريم جابري",
    "muezzin": "عبد الكريم جابري",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abdu_Al_Karem_Jabare_(%D8%B9%D8%A8%D8%AF_%D8%A7%D9%84%D9%83%D8%B1%D9%8A%D9%85_%D8%AC%D8%A7%D8%A8%D8%B1%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-28",
    "name": "عبدالرحمن العراقي",
    "muezzin": "عبدالرحمن العراقي",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abdul_Rahman_Al_Arake_1_(%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D8%B1%D8%AD%D9%85%D9%86_%D8%A7%D9%84%D8%B9%D8%B1%D8%A7%D9%82%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-29",
    "name": "عبدالرحمن ماجد",
    "muezzin": "عبدالرحمن ماجد",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abdul_Rahman_Majde_(%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D8%B1%D8%AD%D9%85%D9%86_%D9%85%D8%A7%D8%AC%D8%AF).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-30",
    "name": "عبدالولي الأركاني",
    "muezzin": "عبدالولي الأركاني",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abdul_Wali_Al_Arkani_(%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D9%88%D9%84%D9%8A_%D8%A7%D9%84%D8%A3%D8%B1%D9%83%D8%A7%D9%86%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-31",
    "name": "أبو ياسر الجزائري",
    "muezzin": "أبو ياسر الجزائري",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Aby_Yasser_Al_Jazaire_(%D8%A3%D8%A8%D9%88_%D9%8A%D8%A7%D8%B3%D8%B1_%D8%A7%D9%84%D8%AC%D8%B2%D8%A7%D8%A6%D8%B1%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-32",
    "name": "آدم أبو سخرة",
    "muezzin": "آدم أبو سخرة",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Adam_Abu_Sakhra_(%D8%A2%D8%AF%D9%85_%D8%A3%D8%A8%D9%88_%D8%B3%D8%AE%D8%B1%D8%A9).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-33",
    "name": "أدهم الشرقاوي",
    "muezzin": "أدهم الشرقاوي",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Adham_Al_Sharqawe_(%D8%A3%D8%AF%D9%87%D9%85_%D8%A7%D9%84%D8%B4%D8%B1%D9%82%D8%A7%D9%88%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-34",
    "name": "الأمين محمد قانيوح",
    "muezzin": "الأمين محمد قانيوح",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Al_Ameen_Muhammad_Qanyouh_(%D8%A7%D9%84%D8%A3%D9%85%D9%8A%D9%86_%D9%85%D8%AD%D9%85%D8%AF_%D9%82%D8%A7%D9%86%D9%8A%D9%88%D8%AD).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-35",
    "name": "البهلول أبو عرقوب",
    "muezzin": "البهلول أبو عرقوب",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Al_Bahlul_Abu_Arqub_1_(%D8%A7%D9%84%D8%A8%D9%87%D9%84%D9%88%D9%84_%D8%A3%D8%A8%D9%88_%D8%B9%D8%B1%D9%82%D9%88%D8%A8).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-36",
    "name": "الدقالي محمد العلام",
    "muezzin": "الدقالي محمد العلام",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Al_Duqale_Muhammad_Al_Alam_(%D8%A7%D9%84%D8%AF%D9%82%D8%A7%D9%84%D9%8A_%D9%85%D8%AD%D9%85%D8%AF_%D8%A7%D9%84%D8%B9%D9%84%D8%A7%D9%85).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-37",
    "name": "أحمد علي مرتضى",
    "muezzin": "أحمد علي مرتضى",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmad_Ali_Murtada_(%D8%A3%D8%AD%D9%85%D8%AF_%D8%B9%D9%84%D9%8A_%D9%85%D8%B1%D8%AA%D8%B6%D9%89).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-38",
    "name": "أحمد فخرو",
    "muezzin": "أحمد فخرو",
    "description": "أذان كامل — قطر",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmad_Fakhru_-_Qatar_(%D8%A3%D8%AD%D9%85%D8%AF_%D9%81%D8%AE%D8%B1%D9%88_-_%D9%82%D8%B7%D8%B1).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-39",
    "name": "ياسر الدوسري",
    "muezzin": "ياسر الدوسري",
    "description": "أذان كامل — المملكة العربية السعودية",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Yasser_Al-Dosari_-_Saudi_Arabia_(%D9%8A%D8%A7%D8%B3%D8%B1_%D8%A7%D9%84%D8%AF%D9%88%D8%B3%D8%B1%D9%8A_-_%D8%A7%D9%84%D9%85%D9%85%D9%84%D9%83%D8%A9_%D8%A7%D9%84%D8%B9%D8%B1%D8%A8%D9%8A%D8%A9_%D8%A7%D9%84%D8%B3%D8%B9%D9%88%D8%AF%D9%8A%D8%A9).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-40",
    "name": "عبدالرحمن كساب",
    "muezzin": "عبدالرحمن كساب",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Abdul_Rahman_Kassab_1_(%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D8%B1%D8%AD%D9%85%D9%86_%D9%83%D8%B3%D8%A7%D8%A8).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-41",
    "name": "أحمد علي",
    "muezzin": "أحمد علي",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmad_Ali_1_(%D8%A3%D8%AD%D9%85%D8%AF_%D8%B9%D9%84%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-42",
    "name": "أحمد نواف المجلد",
    "muezzin": "أحمد نواف المجلد",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ahmad_Nawaf_Al_Mejlad_1_(%D8%A3%D8%AD%D9%85%D8%AF_%D9%86%D9%88%D8%A7%D9%81_%D8%A7%D9%84%D9%85%D8%AC%D9%84%D8%AF).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-43",
    "name": "أخدام بن المداني",
    "muezzin": "أخدام بن المداني",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Akhdam_Bnu_Al_Madane_(%D8%A3%D8%AE%D8%AF%D8%A7%D9%85_%D8%A8%D9%86_%D8%A7%D9%84%D9%85%D8%AF%D8%A7%D9%86%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-44",
    "name": "السيد متولي الآل",
    "muezzin": "السيد متولي الآل",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Al_Saed_Metwale_AL_Aal_(%D8%A7%D9%84%D8%B3%D9%8A%D8%AF_%D9%85%D8%AA%D9%88%D9%84%D9%8A_%D8%A7%D9%84%D8%A2%D9%84).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-45",
    "name": "السيد مسلم",
    "muezzin": "السيد مسلم",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Al_Sayed_Muslim_(%D8%A7%D9%84%D8%B3%D9%8A%D8%AF_%D9%85%D8%B3%D9%84%D9%85).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-46",
    "name": "علي حسن عبد الخالق",
    "muezzin": "علي حسن عبد الخالق",
    "description": "أذان كامل — قطر",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ali_Hassan_Abd_Al_Khaliq_-_Qatar_(%D8%B9%D9%84%D9%8A_%D8%AD%D8%B3%D9%86_%D8%B9%D8%A8%D8%AF_%D8%A7%D9%84%D8%AE%D8%A7%D9%84%D9%82_-_%D9%82%D8%B7%D8%B1).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-47",
    "name": "Ali Ibn Ahmad Mala HQ",
    "muezzin": "Ali Ibn Ahmad Mala HQ",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ali_Ibn_Ahmad_Mala_HQ.mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-48",
    "name": "أنوار دومان",
    "muezzin": "أنوار دومان",
    "description": "أذان كامل — تركيا",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Anuar_Duman_-_Turkey_(%D8%A3%D9%86%D9%88%D8%A7%D8%B1_%D8%AF%D9%88%D9%85%D8%A7%D9%86_-_%D8%AA%D8%B1%D9%83%D9%8A%D8%A7).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-49",
    "name": "عاصم بخراري",
    "muezzin": "عاصم بخراري",
    "description": "أذان كامل — الحرم المكي",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Assem_Bukhrare_-_Al_Haram_Al_Maki_(%D8%B9%D8%A7%D8%B5%D9%85_%D8%A8%D8%AE%D8%B1%D8%A7%D8%B1%D9%8A_-_%D8%A7%D9%84%D8%AD%D8%B1%D9%85_%D8%A7%D9%84%D9%85%D9%83%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-50",
    "name": "Azan nakshabandi",
    "muezzin": "Azan nakshabandi",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Azan_nakshabandi.mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-51",
    "name": "بديع جادو",
    "muezzin": "بديع جادو",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Badee_Jadu_1_(%D8%A8%D8%AF%D9%8A%D8%B9_%D8%AC%D8%A7%D8%AF%D9%88).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-52",
    "name": "بلباشر عبد القادر",
    "muezzin": "بلباشر عبد القادر",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/BalBaSher_Abdel_Qadir_(%D8%A8%D9%84%D8%A8%D8%A7%D8%B4%D8%B1_%D8%B9%D8%A8%D8%AF_%D8%A7%D9%84%D9%82%D8%A7%D8%AF%D8%B1).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-53",
    "name": "بن سوانة",
    "muezzin": "بن سوانة",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Bnu_Sawana_1_(%D8%A8%D9%86_%D8%B3%D9%88%D8%A7%D9%86%D8%A9).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-54",
    "name": "عز الدين عمارنة",
    "muezzin": "عز الدين عمارنة",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ezzedine_Amarna_(%D8%B9%D8%B2_%D8%A7%D9%84%D8%AF%D9%8A%D9%86_%D8%B9%D9%85%D8%A7%D8%B1%D9%86%D8%A9).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-55",
    "name": "اذان الفجر بصوت نصر الدين طوبار",
    "muezzin": "اذان الفجر بصوت نصر الدين طوبار",
    "description": "أذان الفجر",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Fajr_Adhan_by_Nasreddine_Toubar_(%D8%A7%D8%B0%D8%A7%D9%86_%D8%A7%D9%84%D9%81%D8%AC%D8%B1_%D8%A8%D8%B5%D9%88%D8%AA_%D9%86%D8%B5%D8%B1_%D8%A7%D9%84%D8%AF%D9%8A%D9%86_%D8%B7%D9%88%D8%A8%D8%A7%D8%B1).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-56",
    "name": "فارس عبد الغني",
    "muezzin": "فارس عبد الغني",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Fares_Abdul_Ghane_(%D9%81%D8%A7%D8%B1%D8%B3_%D8%B9%D8%A8%D8%AF_%D8%A7%D9%84%D8%BA%D9%86%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-57",
    "name": "فاروق عبدالرحمن حضراوي",
    "muezzin": "فاروق عبدالرحمن حضراوي",
    "description": "أذان كامل — الحرم المكي",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Faruq_Abdul_Rahman_Hadrawe_-_Al_Haram_Al_Maki_(%D9%81%D8%A7%D8%B1%D9%88%D9%82_%D8%B9%D8%A8%D8%AF%D8%A7%D9%84%D8%B1%D8%AD%D9%85%D9%86_%D8%AD%D8%B6%D8%B1%D8%A7%D9%88%D9%8A_-_%D8%A7%D9%84%D8%AD%D8%B1%D9%85_%D8%A7%D9%84%D9%85%D9%83%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-58",
    "name": "فواز فرحان الدماني",
    "muezzin": "فواز فرحان الدماني",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Fawaz_Farhan_Al_Dumane_(%D9%81%D9%88%D8%A7%D8%B2_%D9%81%D8%B1%D8%AD%D8%A7%D9%86_%D8%A7%D9%84%D8%AF%D9%85%D8%A7%D9%86%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-59",
    "name": "فايز عبد السلام",
    "muezzin": "فايز عبد السلام",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Fayz_Abd_Al_Salam_(%D9%81%D8%A7%D9%8A%D8%B2_%D8%B9%D8%A8%D8%AF_%D8%A7%D9%84%D8%B3%D9%84%D8%A7%D9%85).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-60",
    "name": "غرم البيشي",
    "muezzin": "غرم البيشي",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Gharm_Al_Bishi_(%D8%BA%D8%B1%D9%85_%D8%A7%D9%84%D8%A8%D9%8A%D8%B4%D9%8A).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-61",
    "name": "غازي السعدون",
    "muezzin": "غازي السعدون",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Ghazi_Al_Saadoun_(%D8%BA%D8%A7%D8%B2%D9%8A_%D8%A7%D9%84%D8%B3%D8%B9%D8%AF%D9%88%D9%86).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-62",
    "name": "حافظ حسين عرق",
    "muezzin": "حافظ حسين عرق",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Hafed_Hessen_Erq_(%D8%AD%D8%A7%D9%81%D8%B8_%D8%AD%D8%B3%D9%8A%D9%86_%D8%B9%D8%B1%D9%82).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-63",
    "name": "حاج سليمان مختار",
    "muezzin": "حاج سليمان مختار",
    "description": "أذان كامل — الجزائر",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Haj_Sulaiman_Mukhtar_-_Algeria_(%D8%AD%D8%A7%D8%AC_%D8%B3%D9%84%D9%8A%D9%85%D8%A7%D9%86_%D9%85%D8%AE%D8%AA%D8%A7%D8%B1_-_%D8%A7%D9%84%D8%AC%D8%B2%D8%A7%D8%A6%D8%B1).mp3",
    "source": "cdn"
  },
  {
    "id": "adhan-muezzin-64",
    "name": "حمد الدغريري",
    "muezzin": "حمد الدغريري",
    "description": "أذان كامل",
    "url": "https://cdn.jsdelivr.net/gh/Kiwifu/adhan-mp3@main/Hamad_Al_Daghriri_(%D8%AD%D9%85%D8%AF_%D8%A7%D9%84%D8%AF%D8%BA%D8%B1%D9%8A%D8%B1%D9%8A).mp3",
    "source": "cdn"
  }
];

export function getAdhan(id: string): AdhanOption {
  return adhanOptions.find((item) => item.id === id) ?? adhanOptions[0];
}

export function adhanLabel(option: AdhanOption): string {
  return `${option.name} — ${option.description}`;
}
