# إشعارات FCM في تطبيق ثمار (أندرويد)

التطبيق غلاف **WebView أصلي** (بلا Capacitor): نشاط Java واحد يفتح
`https://thimar.freebuff.page`. لذلك لم تُستخدم حزمة `@capacitor/push-notifications`
إطلاقًا، بل كُتب جسر أصلي كامل داخل المشروع.

## ١) المكوّنات

| الملف | الوظيفة |
| --- | --- |
| `app/src/main/java/app/thimar/quran/ThimarMessagingService.java` | خدمة FCM: تجديد الرمز، وعرض الإشعار في المقدمة، وإبلاغ الواجهة |
| `app/src/main/java/app/thimar/quran/NotificationHelper.java` | قناة `thimar_notifications` (صوت النظام + اهتزاز)، الأيقونة واللون، وفتح الصفحة عند الضغط |
| `app/src/main/java/app/thimar/quran/TokenSync.java` | حفظ الرمز وربطه بالحساب عبر RPC آمن، وإلغاء الربط عند الخروج |
| `app/src/main/java/app/thimar/quran/PushBridge.java` | الجسر `window.ThimarNative` (إذن، قناة، رمز، حساب، رابط الإشعار) |
| `app/src/main/java/app/thimar/quran/WebFallbackActivity.java` | يربط الجسر بالصفحة ويفتح مسار الإشعار (`onNewIntent` + حالة الفتح البارد) |
| `src/lib/nativePush.ts` | يطلب الإذن، يربط الرمز بالحساب في Supabase، ويوصّل الضغط بالصفحة |
| `supabase/migrations/20261118_thimar_fcm_tokens.sql` | جدول الرموز + دالتا `thimar_bind_fcm_token` و`thimar_revoke_fcm_token` |
| `freebuff-sites-build/push.js` | إرسال FCM HTTP v1 من `/api/push/send` (نفس مسار إشعارات الويب) |
| `supabase/functions/send-push/index.ts` | بديل خادمي داخل Supabase (يتطلب `THIMAR_PUSH_SECRET`) |

### كيف تصل الإشعارات

- **التطبيق مفتوح:** `onMessageReceived` يعرض الإشعار (FCM لا يعرض تلقائيًا في المقدمة)
  ويُرسل حدث `pushReceived` للواجهة.
- **التطبيق في الخلفية أو مغلق:** النظام يعرض الإشعار من كتلة `notification`
  (القناة والأيقونة واللون من `AndroidManifest.xml`)، والضغط يفتح
  `WebFallbackActivity` بالمسار المطلوب.
- **بعد إعادة تشغيل الهاتف:** يعمل كما في الخلفية؛ الإشعارات العادية (غير المؤجلة)
  تُسلَّم بعد إعادة التشغيل. الإيقاف القسري من إعدادات النظام يمنع التسليم حتى
  يفتح المستخدم التطبيق مرة أخرى (قيد من أندرويد نفسه).

## ٢) الأمان

- الجدول `thimar_fcm_tokens` عليه RLS **بلا أي سياسة** لـ`anon`، وسُحبت صلاحيات
  القراءة/الكتابة المباشرة — التطبيق لا يقرأ الرموز ولا يكتبها مباشرة.
- الربط يجري عبر دالة `security definer` تتحقق من وجود الحساب، وتُلغي ربط أي حساب
  سابق على نفس الجهاز (جهاز واحد = حساب واحد)، ويمنع تسريب إشعارات حساب قديم.
- الإرسال يستخدم OAuth لحساب الخدمة على الخادم فقط؛ لا مفاتيح Firebase في التطبيق.
- قراءة الرموز للإرسال تحتاج مفتاح الخدمة في بيئة الـWorker، لا في المتصفح.

## ٣) ما يجب إضافته على الخادم (مرة واحدة)

Sites ← Secrets:

| الاسم | القيمة | الحالة |
| --- | --- | --- |
| `FCM_SERVICE_ACCOUNT` | محتوى JSON لحساب خدمة Firebase (Project settings ← Service accounts ← Generate new private key) | ✓ مُضاف ومُتحقَّق |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase ← Project settings ← API ← `service_role` (للخادم فقط) | ✗ مطلوب |

للتحقق من الحالة في أي وقت:

```bash
curl -s https://thimar.freebuff.page/api/push/health
```

- `{"fcm":{"oauth":"ok"}}` تعني أن حساب الخدمة صالح وأن Google أصدرت رمز OAuth.
- `{"supabase":{"serviceRoleKey":"missing"}}` تعني أن الخادم لا يستطيع قراءة رموز
  الأجهزة، فلا يُرسل أي إشعار أندرويد (المفتاح لا يظهر في أي مكان، والمفتاح نفسه
  لا يُطبع).

بدون مفتاح الخدمة تعيد `/api/push/send`:
`{"fcm":{"reason":"SUPABASE_SERVICE_ROLE_KEY_MISSING"}}`. إشعارات الويب (PWA)
تعمل بغيره.

> بديل: نشر دالة `send-push` داخل Supabase وضبط `FCM_SERVICE_ACCOUNT` و
> `THIMAR_PUSH_SECRET` هناك:
> ```bash
> npx supabase functions deploy send-push
> ```

## ٤) بناء APK

```bash
cd packaging/android
# يحتاج Android SDK + JDK 17
gradle :app:assembleRelease
```

- المعرّف: `app.thimar.quran` (مطابق لـ`google-services.json`).
- المفتاح: `keys/thimar-release.jks` (أو `THIMAR_KEYSTORE`).
- الناتج: `app/build/outputs/apk/release/app-release.apk` — ومنسوخ أيضًا في
  `artifacts/thimar.apk`.

## ٥) الاختبار على جهاز حقيقي (حسابان)

1. ثبّت APK الجديد (النسخة 1.6.0 — القديمة لا تحتوي أي إشعارات).
2. سجّل الدخول بالحساب الأول ووافق على إذن الإشعارات (أندرويد 13+).
3. تحقق من الصف في قاعدة البيانات:
   ```sql
   select token, account_id, device_id, updated_at from public.thimar_fcm_tokens;
   ```
4. من حساب ثانٍ (معلم/مسؤول) أرسل رسالة أو إشعارًا للحساب الأول.
5. كرر والتطبيق مفتوح، ثم في الخلفية، ثم مغلقًا تمامًا، ثم بعد إعادة تشغيل الهاتف.
6. اضغط الإشعار وتأكد أنه يفتح المحادثة نفسها (الإشعار يحمل `/messages?c=<معرّف المحادثة>`).
   إعلانات الإدارة تُنشأ من صفحة الرسائل ← زر `+` ← تبويب «إعلان» (للمسؤول فقط)،
   وتصل إلى كل الحسابات كإشعار ومحادثة.
7. سجّل الخروج وتأكد أن صف الرمز حُذف، وأن إشعارات الحساب السابق لا تصل.

> الحالة (1.7.1): بُني الكود وAPK ووُقّع بنفس مفتاح ثمار. تحقّقت طبقة قاعدة
> البيانات عبر REST (ربط 204، نقل الجهاز إلى حساب آخر 204، إلغاء 1، قراءة مباشرة
> 401). وتحقّق حساب خدمة Firebase عبر `/api/push/health` (`oauth: ok`).
> ما تبقّى: `SUPABASE_SERVICE_ROLE_KEY` ثم تثبيت النسخة 1.7.1 على جهازين
> واختبار التسليم فعليًا — لا يُعدّ FCM مكتملًا قبله.

## تحديث 1.7.1 — مراجعة أمنية وإصلاحات

- **قراءة رموز الأجهزة صارت لا تعتمد على مفتاح الخدمة:** دالة `thimar_push_tokens(p_secret, p_account_ids)`
  (security definer) تتحقّق من سرّ مشترك مخزَّن كـSHA-512 في `thimar_push_config`، والسرّ نفسه
  في Sites → Secrets باسم `THIMAR_PUSH_SECRET`. فإن كان `SUPABASE_SERVICE_ROLE_KEY` غير صالح
  (كما كان: يعمل بصلاحية anon) يعمل الإرسال عبر الدالة بدل أن يفشل بـ401.
- **حماية مسار الإرسال:** `/api/push/send` يرفض الأصل الخارجي (403) ويحدّ الطلبات (40/دقيقة/IP).
  و`/api/push/tick` (أذان وتذكيرات لكل المستخدمين) صار يتطلب ترويسة `x-thimar-tick`.
- **إصلاح رابط الإشعار:** الإشعار الذي يعرضه النظام والتطبيق مغلق/في الخلفية يصل كـdata payload،
  وكان التطبيق يقرأ `thimar_url` فقط فيفقد الرابط. الآن يقرأ `url` أيضًا، فيُفتح نفس المحادثة/الشاشة.
- **منع تسريب البيانات:** `allowBackup=false` + `dataExtractionRules` تمنع نسخ رموز الإشعارات
  وجلسة الحساب إلى النسخ الاحتياطي أو نقل الجهاز.
- **التشخيص** `/api/push/health` يعرض `tokenSource` (service_role أو secret_rpc) وعدد الرموز فقط، بلا أسرار.

### سلوك الإشعارات (كما يسمح النظام)
| الحالة | من يعرض الإشعار | الضغط عليه |
|---|---|---|
| التطبيق مفتوح | `ThimarMessagingService` (قناة thimar_notifications) | يفتح الصفحة داخليًا |
| في الخلفية | نظام أندرويد عبر كتلة notification + click_action | يفتح النشاط بالرابط |
| مغلق تمامًا | نظام أندرويد | يفتح النشاط بالرابط (بعد إصلاح 1.7.1) |
| التطبيق «موقوف قسرًا» أو مُقيَّد البطارية | لا يصل شيء — قيد أندرويد | — |
