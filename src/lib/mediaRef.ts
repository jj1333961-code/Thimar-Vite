/**
 * عرض الوسائط المحمية (`thimar-media:<uuid>`).
 *
 * الوسائط لم تعد في حاوية عامة: تُجلب من الخادم عبر `media.get` بعد التحقق من
 * العضوية، فتُحوَّل إلى رابط blob صالح للعرض. هذا الخطّاف يوفّر الرابط الجاهز
 * ويعيد الرسم عند وصوله.
 */
import { useEffect, useState } from "react";
import { cachedMediaUrl, isMediaRef, onMediaResolved, resolveMediaUrl } from "./cloud";

export function useMediaSrc(): (src?: string) => string | undefined {
  const [, setVersion] = useState(0);

  useEffect(() => onMediaResolved(() => setVersion((value) => value + 1)), []);

  return (src?: string) => {
    if (!src) return undefined;
    if (!isMediaRef(src)) return src;
    const cached = cachedMediaUrl(src);
    if (cached) return cached;
    void resolveMediaUrl(src).then((url) => {
      if (url) setVersion((value) => value + 1);
    });
    return undefined;
  };
}
