import { useCallback, useRef, useState } from "react";
import { mediaErrorMessage } from "./speech";

export type RecordingResult = {
  dataUrl: string;
  duration: number;
  mimeType: string;
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("تعذّر قراءة التسجيل."));
    reader.readAsDataURL(blob);
  });
}

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<number | null>(null);
  const startedRef = useRef(0);

  const stopTicker = useCallback(() => {
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("المتصفح لا يدعم الوصول إلى الميكروفون. استخدم الكتابة أو أرسل ملفًا.");
      return false;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("تسجيل الصوت غير مدعوم في هذا المتصفح. يمكنك إرسال ملف صوتي بدلًا من التسجيل.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      setSeconds(0);
      setRecording(true);
      stopTicker();
      tickRef.current = window.setInterval(() => {
        setSeconds(Math.floor((Date.now() - startedRef.current) / 1000));
      }, 1000);
      return true;
    } catch (error) {
      setError(mediaErrorMessage(error));
      return false;
    }
  }, [stopTicker]);

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    const recorder = recorderRef.current;
    if (!recorder) return null;
    const duration = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000));
    return new Promise((resolve) => {
      recorder.onstop = async () => {
        stopTicker();
        setRecording(false);
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        recorder.stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        if (blob.size === 0) {
          resolve(null);
          return;
        }
        const dataUrl = await blobToDataUrl(blob);
        resolve({ dataUrl, duration, mimeType: blob.type });
      };
      recorder.stop();
    });
  }, [stopTicker]);

  return { recording, seconds, error, start, stop };
}
