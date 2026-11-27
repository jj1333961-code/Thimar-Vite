/**
 * دالة متقاعدة: تُنشر على أسماء الدوال القديمة (thimar-calls-v2, thimar-calls-test)
 * بعد إثبات أن لا إصدار من التطبيق ولا حزمة ويب منشورة يستدعيها.
 *
 * الهدف إزالة سطح الهجوم (كانت تقبل هوية المتصل من جسم الطلب) مع إبقاء الاسم
 * محجوزًا حتى لا يحييه نشر قديم بالخطأ.
 */
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "FUNCTION_RETIRED", use: "thimar-calls" }),
    {
      status: 410,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    },
  ),
);
