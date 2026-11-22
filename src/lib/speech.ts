export function hasSpeechRecognition(): boolean {
  const scope = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(scope.SpeechRecognition ?? scope.webkitSpeechRecognition);
}

export function hasSpeechSynthesis(): boolean {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function getArabicVoice(): SpeechSynthesisVoice | null {
  if (!hasSpeechSynthesis()) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => voice.lang.toLowerCase().startsWith("ar-eg")) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("ar")) ??
    voices.find((voice) => /arab/i.test(voice.name)) ??
    null
  );
}

export function recognitionErrorMessage(error?: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "لم يُسمح لخدمة تحويل الكلام بالعمل. اسمح بالميكروفون من إعدادات الموقع، وتأكد من أن المتصفح أو النظام يدعم خدمة التعرف على الكلام — بعض المتصفحات والبيئات السحابية تمنعها. يمكنك المتابعة بالكتابة اليدوية الآن.";
    case "audio-capture":
      return "لم يُعثر على ميكروفون متاح على هذا الجهاز. وصّل ميكروفونًا أو استخدم الكتابة/اللصق للمتابعة.";
    case "network":
      return "تعذّر الوصول إلى خدمة تحويل الكلام إلى نص. تحقق من اتصال الإنترنت أو استخدم الكتابة اليدوية.";
    case "no-speech":
      return "لم نسمع صوتًا واضحًا. اقترب من الميكروفون وتحدّث، أو استخدم الكتابة اليدوية.";
    case "aborted":
      return "";
    default:
      return "تعذّر التعرف على الصوت. جرّب مرة أخرى، أو استخدم الكتابة اليدوية للمتابعة.";
  }
}

export function cameraErrorMessage(error: unknown): string {
  const name =
    error instanceof DOMException
      ? error.name
      : error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name ?? "")
        : "";
  switch (name) {
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "لا توجد كاميرا متاحة على هذا الجهاز. وصّل كاميرا ثم أعد المحاولة.";
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "لم يُسمح باستخدام الكاميرا. اسمح بالوصول من إعدادات الموقع في المتصفح ثم أعد المحاولة.";
    case "NotReadableError":
    case "TrackStartError":
      return "الكاميرا مستخدمة من تطبيق آخر أو غير متاحة حاليًا.";
    case "OverconstrainedError":
      return "إعدادات الكاميرا غير مدعومة على هذا الجهاز.";
    default:
      return "تعذّر الوصول إلى الكاميرا. تحقق من إذن الكاميرا ثم أعد المحاولة.";
  }
}

export function mediaErrorMessage(error: unknown): string {
  const name =
    error instanceof DOMException
      ? error.name
      : error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name ?? "")
        : "";
  switch (name) {
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "لا يوجد ميكروفون متاح على هذا الجهاز. وصّل ميكروفونًا أو استخدم الكتابة اليدوية.";
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "لم يُسمح باستخدام الميكروفون. اسمح بالوصول من إعدادات الموقع في المتصفح ثم أعد المحاولة.";
    case "NotReadableError":
    case "TrackStartError":
      return "الميكروفون مستخدم من تطبيق آخر أو غير متاح حاليًا.";
    case "OverconstrainedError":
      return "إعدادات الميكروفون غير مدعومة على هذا الجهاز.";
    default:
      return "تعذّر الوصول إلى الميكروفون. تحقق من إذن الميكروفون أو استخدم الكتابة اليدوية.";
  }
}
