# مسار staging — Worker + Durable Object للمكالمات

**الحالة: غير منشور.** لا مسارات (routes)، `workers_dev: false`، ولا أمر نشر في هذا المجلد.
هذا الإعداد للاختبار المحلي على workerd فقط، ولا يمسّ العامل الحالي `/api/push` و`/api/ai`.

## الملفات

| الملف | المسؤولية |
|---|---|
| `src/index.ts` | البوابة: `/api/health`, `/api/turn`, `/api/rooms/:id/token`, `/api/rooms/:id/ws`, `/api/calls/*` |
| `src/auth.ts` | تحقّق رمز الجلسة (HS256)، بطاقة غرفة، ورمز جلسة SFU موقّع |
| `src/room.ts` | `CallRoom` Durable Object: حضور، توزيع إشارات، منع التكرار، حد 10 مشاركين |
| `src/realtime.ts` | Cloudflare Realtime: اعتماد TURN مؤقت، ووكل SFU مع تحقق المدخلات |
| `test/api.test.ts` | 22 اختبارًا للبوابة والمصادقة والتفويض وTURN/SFU |
| `test/room.test.ts` | 6 اختبارات للغرفة والحد الأقصى وإعادة الاتصال |
| `test/realtime.test.ts` | 9 اختبارات لتحويل عمليات SFU والتحقق من المدخلات |

## نقاط النهاية

- `GET /api/health` — بلا مصادقة، بلا أسرار.
- `GET /api/turn` — يتطلب جلسة؛ يعيد اعتماد TURN مؤقتًا. المزوّد المفضّل Cloudflare Realtime (`TURN_KEY_ID` + `TURN_KEY_API_TOKEN`)، ثم coturn بمفتاح مشترك (`TURN_SHARED_SECRET`). بلا أي منهما: `503 TURN_NOT_CONFIGURED` (لا احتياطي دائم).
- `POST /api/rooms/:id/token` — يتطلب جلسة؛ يتحقق من العضوية عبر `thimar_calls` بمفتاح الخدمة على الخادم فقط، ثم يعيد `ticket` قصير العمر.
- `GET /api/rooms/:id/ws?ticket=...` — WebSocket يُوجَّه إلى كائن الغرفة. الحادي عشر يُرفض بـ`409 ROOM_FULL`. الإشارات فقط؛ لا وسائط عبر WebSocket.
- `POST /api/calls/session/new` — يتحقق من عضوية المحادثة (`conversations.member_ids` أو `thimar_calls`)، ينشئ جلسة SFU، ويعيد `sessionToken` موقّعًا مربوطًا بالمستخدم والغرفة.
- `POST /api/calls/session/tracks/new` · `PUT /api/calls/session/renegotiate` · `PUT /api/calls/session/tracks/close` — تتطلب `X-Sfu-Session` الصالح لنفس المستخدم والغرفة؛ تُمرَّر إلى Cloudflare Realtime ولا تُكشف أسرار التطبيق.

## الاختبارات

```sh
npm run test:cf     # workerd عبر miniflare (19 اختبارًا)
npm run test:turn   # منطق TURN REST API على Node (11 اختبارًا)
```

## الأسرار المطلوبة عند النشر لاحقًا (Sites → Secrets، لا في الملفات)

`SESSION_SIGNING_SECRET` · `SUPABASE_URL` · `SUPABASE_SERVICE_KEY` · `THIMAR_ALLOWED_ORIGINS` (اختياري)

اختياري حسب المزوّد:

- Cloudflare Realtime TURN: `TURN_KEY_ID` · `TURN_KEY_API_TOKEN`
- coturn/TURN REST API: `TURN_SHARED_SECRET` (+ `TURN_URLS` إن لم يكن expressturn)
- Cloudflare Realtime SFU للمكالمات الجماعية: `CF_REALTIME_APP_ID` · `CF_REALTIME_APP_SECRET`

## ما لم يُنفَّذ بعد

- النشر على الحساب (مصادقة Cloudflare ما زالت معطوبة: 6003/6102/6103).
- تفعيل Durable Objects على حساب حقيقي — يتطلب Workers Paid وموافقة صريحة.
- قياسات جودة مكالمات حقيقية على أجهزة وشبكات فعلية (يحتاج جهازين وشبكات مختلفة).
