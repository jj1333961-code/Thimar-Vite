import { useEffect, useRef } from "react";

/**
 * يرتّب طبقات الواجهة فوق بعضها: كل نافذة/صفحة فرعية تُدفع في سجل المتصفح،
 * وعند الضغط على زر الرجوع في الهاتف تُغلق الطبقة العليا فقط.
 */
type Layer = { close: () => void };

const stack: Layer[] = [];
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("popstate", () => {
    const layer = stack.pop();
    if (layer) layer.close();
  });
}

/**
 * يربط حالة فتح عنصر بزر الرجوع في الهاتف.
 * الدالة المُعادة تُغلق العنصر مع إزالة حالته من السجل (بدل زر × فقط).
 */
export function useHistoryBack(open: boolean, onBack: () => void, stateKey = "thimarLayer") {
  const backRef = useRef(onBack);
  backRef.current = onBack;
  const layerRef = useRef<Layer | null>(null);

  useEffect(() => {
    if (!open) {
      layerRef.current = null;
      return;
    }
    listen();
    if (!layerRef.current) {
      const layer: Layer = { close: () => backRef.current() };
      layerRef.current = layer;
      stack.push(layer);
      window.history.pushState({ [stateKey]: true }, "");
    } else if (!stack.includes(layerRef.current)) {
      // إعادة تركيب في وضع التطوير: نعيد الطبقة دون دفع حالة جديدة.
      stack.push(layerRef.current);
    }
    return () => {
      const layer = layerRef.current;
      if (!layer) return;
      const index = stack.lastIndexOf(layer);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [open, stateKey]);

  return () => {
    if (layerRef.current) window.history.back();
    else backRef.current();
  };
}
