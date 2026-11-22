# نسخة الآيفون (iOS)

## ما يمكن تثبيته اليوم بدون أي حساب مطوّر
افتح `https://thimar.freebuff.page` في **Safari** على الآيفون ← زر المشاركة ← **إضافة إلى الشاشة الرئيسية**.
يعمل التطبيق بملء الشاشة، وله أيقونة، ويحفظ الجلسة والبيانات كما في الموقع.

## لماذا لا يوجد ملف .ipa جاهز هنا
ملف IPA **لا يعمل إلا إذا وُقّع بشهادة Apple** مرتبطة بجهازك أو بحساب مطوّر.
التوقيع يتطلب:
- جهاز macOS مع Xcode 15 أو أحدث،
- Apple ID (مجاني) للتثبيت على جهاز واحد لمدة 7 أيام، أو حساب Apple Developer (99$/سنة) للتثبيت لمدة سنة،
- إنشاء App ID + شهادة توقيع + Provisioning Profile يضم UDID جهازك.

لا يوجد أي من هذه العناصر في بيئة العمل الحالية (Linux بلا Xcode ولا شهادات Apple)،
ولا يمكن توليد توقيع صالح من هنا. أي IPA غير موقّع لن يُثبَّت على الآيفون.

## خطوات إنتاج IPA موقّع على جهاز Mac
1. ثبّت Node وCocoaPods، ثم من جذر المشروع:
   ```bash
   npm install
   npm install @capacitor/core @capacitor/cli @capacitor/ios
   npx cap init "ثمار" app.thimar.quran --web-dir=dist
   npm run build
   npx cap add ios
   npx cap sync ios
   npx cap open ios
   ```
2. في Xcode: اختر Team (حسابك)، وBundle Identifier = `app.thimar.quran`.
3. أضف صلاحيات الاستخدام في `Info.plist`:
   - `NSMicrophoneUsageDescription` — للتسميع الصوتي.
   - `NSCameraUsageDescription` — لاختبار الكاميرا في الاختبار النهائي.
   - `NSLocationWhenInUseUsageDescription` — لمواقيت الصلاة والقبلة.
4. وصّل الآيفون، ثم Product → Archive → Distribute App → **Ad Hoc** أو **Development**
   لإنتاج ملف `.ipa` وتثبيته عبر Apple Configurator أو AltStore.
5. للاستخدام المؤسسي/الخاص: Ad Hoc مع UDID الأجهزة، أو Apple Developer Enterprise Program.

## بديل جاهز: PWA
الموقع منشور على `https://thimar.freebuff.page` مع manifest وأيقونات، لذا التثبيت من Safari
هو الحل الأسرع والآمن للآيفون بدون حسابات مطوّرين.
