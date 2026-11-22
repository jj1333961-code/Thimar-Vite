/**
 * مراقبة الوجه والعين في المتصفح — تعمل فعليًا دون أي إضافة على الجهاز.
 * تُحمَّل مكتبة MediaPipe Face Landmarker مرة واحدة عند الحاجة من الشبكة،
 * ثم تُحلَّل صورة الكاميرا ~4 مرات/ثانية وتُستخرج نقاط الوجه والعينين.
 */

const VISION_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

type Landmark = { x: number; y: number; z?: number };

export type FaceReading = {
  /** ظهر وجه في الكاميرا. */
  face: boolean;
  /** الوجه في وسط الإطار (لا يمينًا ولا يسارًا ولا أعلى/أسفل). */
  centered: boolean;
  /** العينان مفتوحتان والنظر متجه إلى الشاشة. */
  looking: boolean;
  /** العينان مفتوحتان. */
  eyesOpen: boolean;
  /** انحراف الرأس أفقيًا بالدرجات (تقديري). */
  yaw: number;
};

type LandmarkerLike = {
  detectForVideo: (video: HTMLVideoElement, ts: number) => { faceLandmarks?: Landmark[][] };
  close: () => void;
};

type VisionModule = {
  FilesetResolver: { forVisionTasks: (path: string) => Promise<unknown> };
  FaceLandmarker: {
    createFromOptions: (
      fileset: unknown,
      options: Record<string, unknown>,
    ) => Promise<LandmarkerLike>;
  };
};

let landmarkerPromise: Promise<LandmarkerLike> | null = null;

async function loadLandmarker(): Promise<LandmarkerLike> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const mod = (await import(/* @vite-ignore */ `${VISION_CDN}/vision_bundle.mjs`)) as VisionModule;
      const fileset = await mod.FilesetResolver.forVisionTasks(`${VISION_CDN}/wasm`);
      const options = {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      };
      try {
        return await mod.FaceLandmarker.createFromOptions(fileset, options);
      } catch {
        return await mod.FaceLandmarker.createFromOptions(fileset, {
          ...options,
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        });
      }
    })().catch((error) => {
      landmarkerPromise = null;
      throw error;
    });
  }
  return landmarkerPromise;
}

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const RIGHT_EYE = { outer: 33, inner: 133, upper: 159, lower: 145, iris: 468 };
const LEFT_EYE = { outer: 362, inner: 263, upper: 386, lower: 374, iris: 473 };

function eyeState(
  points: Landmark[],
  eye: { outer: number; inner: number; upper: number; lower: number; iris: number },
) {
  const outer = points[eye.outer];
  const inner = points[eye.inner];
  const upper = points[eye.upper];
  const lower = points[eye.lower];
  const iris = points[eye.iris];
  if (!outer || !inner || !upper || !lower) return { open: true, centered: true };
  const width = Math.max(1e-5, dist(outer, inner));
  const open = dist(upper, lower) / width > 0.14;
  if (!iris) return { open, centered: true };
  const minX = Math.min(outer.x, inner.x);
  const ratio = (iris.x - minX) / width;
  /* يجب أن يكون سواد العين داخل حدود جفنها — أي في منتصفها تقريبًا. */
  return { open, centered: ratio > 0.24 && ratio < 0.76 };
}

export async function createFaceMonitor(): Promise<{
  detect: (video: HTMLVideoElement) => FaceReading;
  close: () => void;
}> {
  const landmarker = await loadLandmarker();
  let lastTs = 0;
  return {
    detect(video) {
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      const result = landmarker.detectForVideo(video, ts);
      const points = result.faceLandmarks?.[0] ?? [];
      if (points.length < 468) {
        return { face: false, centered: false, looking: false, eyesOpen: false, yaw: 0 };
      }
      /* وسط الوجه من حدود الخدّين والجبهة والذقن. */
      const left = points[234];
      const right = points[454];
      const top = points[10];
      const chin = points[152];
      const nose = points[1];
      const faceWidth = Math.max(1e-5, Math.hypot(left.x - right.x, left.y - right.y));
      const faceHeight = Math.max(1e-5, Math.hypot(top.x - chin.x, top.y - chin.y));
      const middleX = (left.x + right.x) / 2;
      const middleY = (top.y + chin.y) / 2;
      const yawOffset = (nose.x - middleX) / faceWidth;
      const pitchOffset = (nose.y - middleY) / faceHeight;
      const yaw = Math.round((yawOffset / 0.5) * 45);
      /* الوجه داخل الإطار؟ الحجم يجب ألا يكون صغيرًا جدًا ولا مقطوعًا. */
      const sizeOk = faceWidth > 0.16 && faceHeight > 0.2;
      const inFrame = middleX > 0.16 && middleX < 0.84 && middleY > 0.12 && middleY < 0.9;
      const centered = sizeOk && inFrame && Math.abs(yawOffset) < 0.17 && Math.abs(pitchOffset) < 0.2;
      const rightEye = eyeState(points, RIGHT_EYE);
      const leftEye = eyeState(points, LEFT_EYE);
      const eyesOpen = rightEye.open && leftEye.open;
      const gaze = rightEye.centered && leftEye.centered;
      return {
        face: true,
        centered,
        eyesOpen,
        looking: centered && eyesOpen && gaze,
        yaw,
      };
    },
    close() {
      try {
        landmarker.close();
      } catch {
        /* ignore */
      }
      landmarkerPromise = null;
    },
  };
}
