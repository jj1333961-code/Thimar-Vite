# ثمار — تطبيق حفظ القرآن الكريم

واجهة React + Vite، مع خادم تطوير وسيط للذكاء الاصطناعي في `vite.config.ts`
(`/api/ai/chat`) يتصل بمزوّد متوافق مع OpenAI.

## التشغيل السريع

```bash
npm install
cp .env.example .env      # ثم املأ AI_API_KEY بمفتاح المزوّد
python3 -m venv .venv
.venv/bin/pip install --only-binary=:all: -r requirements.txt   # Windows: .venv\Scripts\pip
```

شغّل البوابة في نافذة، والتطبيق في نافذة أخرى:

```bash
npm run gateway     # بوابة Respan المحلية على http://127.0.0.1:8087
npm run dev         # التطبيق على http://localhost:3000
```

أمر `npm run gateway` يستخدم `.venv` تلقائيًا، ويقرأ `AI_API_KEY` من `.env`.
إن أردت تجاوز البوابة، ضع `AI_API_BASE=https://api.z.ai/api/paas/v4` في `.env`.

## بوابة Respan (توجيه الذكاء الاصطناعي)

كل طلبات الذكاء الاصطناعي في التطبيق (رفيق ثمار، تصحيح التسميع، الرد على الشكاوى)
تمر الآن عبر بوابة Respan محلية على العناوين:

```
المتصفح → /api/ai/chat (vite.config.ts) → Respan Gateway 127.0.0.1:8087 → المزوّد
```

- `gateway.toml` — إعداد البوابة: مزوّد `zai` المتوافق مع OpenAI، ومفتاحه
  `env:AI_API_KEY` (لا يُكتب المفتاح في الملف)، وتوجيه `glm-*` إلى ذلك المزوّد.
- `.env` — `AI_API_BASE=http://127.0.0.1:8087/v1` هو ما يجعل التطبيق يستخدم البوابة،
  و`AI_API_KEY` يبقى في الملف المتجاهَل بواسطة Git.
- `requirements.txt` — يثبّت `respan-gateway==0.3.0` من wheels.
- `scripts/gateway.py` — يشغّل البوابة على loopback فقط (`npm run gateway`).
- `scripts/gateway_smoke.py` — اختبار الدخان (`npm run gateway:smoke`).

فحص الإعداد دون تشغيل الطلبات:

```bash
.venv/bin/respan-gateway check --config gateway.toml
```

واجهة البوابة الإدارية وسجل الطلبات: <http://127.0.0.1:8087/ui/>.

### نتيجة اختبار الدخان

`npm run gateway:smoke` يشغّل مزوّدًا وهميًا متوافقًا مع OpenAI محليًا، ويوجّه إليه
`gateway.toml`، ثم يرسل الطلب عبر مسار التطبيق نفسه `/api/ai/chat`:

```
fixture provider  http://127.0.0.1:37347/v1
gateway           http://127.0.0.1:8087
app proxy         http://127.0.0.1:3100/api/ai/chat
status            200
content           FIXTURE-REPLY glm-4.7-flash
gateway requests  1
PASS: app proxy -> Respan Gateway -> provider fixture
```

أي أن الطلب خرج من وسيط التطبيق، ودخل البوابة، ووصل إلى المزوّد، وعاد بالرد — مع
الاحتفاظ باسم النموذج `glm-4.7-flash`. **لم يُتحقق من طلب حقيقي إلى مزوّد فعلي** في
هذه البيئة لعدم وجود مفتاح؛ التشغيل الحقيقي يحدث عند تشغيل `npm run dev` مع مفتاحك.

الدليل الرسمي: <https://github.com/respanai/respan-gateway?utm_source=freebuff&utm_medium=paid&utm_campaign=respan-gateway&bfcid=bfc_1.eyJpZCI6ImNjMmUxYTA5LWRhZWUtNDZiZi04YThiLTM1NGY4OTZlZDA5NiIsImMiOiIyMDM2ODZkZS1mMzg0LTQ4NTQtYmViNC1hYzBiYWRmNmM1NTUiLCJrIjoiM2IxMGE4YmUtNzgyOS00MmJhLWFmNmEtYmI0YWUxZTRhY2Y4IiwiaWF0IjoxNzk0NTc5MjQzfQ.0_3k-Vpy0HymQWW8BlkeUmfoCP52uLj_2DO2fvodvVE>

## Nace Drex (قرارات مُعايرة)

`src/lib/nace.ts` يسأل Drex أسئلة مُصنّفة (`noul` / `choice` / `score`) عن حالة
واقعة واحدة، ويعيد احتمالًا مُعايرًا لكل خيار، ثم يوجّه القرار بحسبها. المفتاح
سري، لذلك يمر الطلب عبر وسيط التطوير `/api/nace/decide` في `vite.config.ts`:

```
المتصفح → /api/nace/decide (vite.config.ts) → Nace Drex
```

- `.env` — `NACE_API_KEY` يُقرأ على الخادم فقط ولا يصل إلى المتصفح.
- `NACE_DREX_MODEL` — اختياري، افتراضيًا `drex-latest`.
- `/api/nace/health` — يبيّن إن كان المفتاح مضبوطًا والنموذج المطلوب.

```ts
import { askDrex, routeChoice } from "./lib/nace";

const { answers } = await askDrex(
  { complaint: "الدرس لا يفتح عندي منذ يومين", plan: "مجاني" },
  {
    is_urgent: { type: "noul", instructions: "هل يمنع هذا العطل استخدام التطبيق؟" },
    team: {
      type: "choice",
      instructions: "أي فريق يتولى هذه الشكوى؟",
      criteria: { support: "أسئلة الاستخدام", technical: "أعطال وأخطاء", billing: "مدفوعات" },
    },
  },
);

const team = answers.team;
if (team.type === "choice") {
  // احتمال كل خيار متاح في team.probabilities، والاحتمال الأعلى يوجّه الشكوى.
  const { route, confident } = routeChoice(team, "support", 0.7);
  console.log(route, confident, team.probabilities);
}
```

المفتاح من <https://console.nace.ai>، ودليل Drex: <https://console.nace.ai/docs/drex/quickstart>.
