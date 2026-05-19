"use client";

type FaceApiModule = typeof import("@vladmandic/face-api");
let faceapi: FaceApiModule | null = null;

let modelsLoaded = false;
let loadPromise: Promise<void> | null = null;
let loadingStatus = "";

export function getLoadingStatus(): string {
  return loadingStatus;
}

async function getFaceApi(): Promise<FaceApiModule> {
  if (!faceapi) {
    faceapi = await import("@vladmandic/face-api");
    try {
      await (faceapi.tf as any).setBackend("cpu");
      await (faceapi.tf as any).ready();
      console.log("TF.js backend: cpu (forced)");
    } catch (e) {
      console.warn("TF.js CPU backend failed:", e);
    }
  }
  return faceapi;
}

async function ensureModels(): Promise<void> {
  if (modelsLoaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const api = await getFaceApi();
    try {
      await (api.tf as any).ready();
      console.log("TF.js backend:", (api.tf as any).getBackend());
    } catch (e) {
      console.warn("TF.js ready:", e);
    }
    const base = window.location.origin + "/models";
    loadingStatus = "Loading face detection (1/3)...";
    await api.nets.tinyFaceDetector.loadFromUri(base);
    loadingStatus = "Loading face landmarks (2/3)...";
    await api.nets.faceLandmark68Net.loadFromUri(base);
    loadingStatus = "Loading face recognition (3/3)...";
    await api.nets.faceRecognitionNet.loadFromUri(base);
    modelsLoaded = true;
    loadingStatus = "";
  })();
  return loadPromise;
}

export type FaceEncoding = number[];

export interface QualityResult {
  blurry: boolean;
  blur_score: number;
  dark: boolean;
  brightness: number;
  good_quality: boolean;
  face_count?: number;
  max_detection_score?: number;
}

async function ensureLoaded(img: HTMLImageElement): Promise<HTMLImageElement> {
  if (img.complete && img.naturalWidth > 0) return img;
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = reject;
  });
}

// --- Native FaceDetector API (Apple/iOS Safari) ---
interface NativeFaceBox {
  x: number; y: number; width: number; height: number;
}

let nativeDetector: any = null;

function getNativeDetector(): any {
  if (nativeDetector) return nativeDetector;
  if (typeof (window as any).FaceDetector !== "undefined") {
    nativeDetector = new (window as any).FaceDetector({
      maxDetectedFaces: 10,
      fastMode: true,
    });
    return nativeDetector;
  }
  return null;
}

async function detectWithNative(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<NativeFaceBox[] | null> {
  const detector = getNativeDetector();
  if (!detector) return null;
  try {
    const faces = await detector.detect(source);
    if (!faces || faces.length === 0) return [];
    return faces.map((f: any) => ({
      x: f.boundingBox.x,
      y: f.boundingBox.y,
      width: f.boundingBox.width,
      height: f.boundingBox.height,
    }));
  } catch (e) {
    return null;
  }
}

// --- Core: detect + get descriptors using native or fallback ---
async function detectFacesAndGetDescriptors(
  source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<{
  success: boolean;
  encodings?: FaceEncoding[];
  locations?: number[][];
  scores?: number[];
  message?: string;
  usedNative?: boolean;
}> {
  const api = await getFaceApi();
  await ensureModels();

  // Try native FaceDetector first (Apple/iOS)
  let nativeBoxes: NativeFaceBox[] | null = null;
  try { nativeBoxes = await detectWithNative(source); } catch {}
  
  if (nativeBoxes !== null && nativeBoxes.length > 0) {
    const rects = nativeBoxes.map(b => new api.Rect(b.x, b.y, b.width, b.height));
    const alignedFaces = await api.extractFaces(source, rects);
    const encodings: FaceEncoding[] = [];
    const locations: number[][] = [];
    const scores: number[] = [];

    for (let i = 0; i < alignedFaces.length; i++) {
      let desc = await api.nets.faceRecognitionNet.computeFaceDescriptor(alignedFaces[i]);
      if (Array.isArray(desc)) desc = desc[0];
      const box = nativeBoxes[i];
      if (box.width < 30 || box.height < 30) continue;
      encodings.push(Array.from(desc));
      locations.push([box.x, box.y, box.width, box.height]);
      scores.push(1.0);
    }

    if (encodings.length > 0) {
      return { success: true, encodings, locations, scores, message: "", usedNative: true };
    }
    return { success: false, message: "No face detected." };
  }

  // Fallback: face-api.js TinyFaceDetector
  const opts = new api.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.1 });
  const results = await api
    .detectAllFaces(source, opts)
    .withFaceLandmarks()
    .withFaceDescriptors();

  const encodings: FaceEncoding[] = [];
  const locations: number[][] = [];
  const scores: number[] = [];

  for (const r of results) {
    const desc = Array.from(r.descriptor);
    const score = r.detection.score;
    const box = r.detection.box;
    if (box.width < 30 || box.height < 30) continue;
    encodings.push(desc);
    locations.push([box.x, box.y, box.width, box.height]);
    scores.push(score);
  }

  if (encodings.length === 0) {
    return { success: false, message: "No face detected." };
  }

  return { success: true, encodings, locations, scores, usedNative: false };
}

// --- Public API ---

export async function encodeAllFacesFromVideo(
  source: HTMLVideoElement | HTMLCanvasElement
): Promise<{
  success: boolean;
  encodings?: FaceEncoding[];
  locations?: number[][];
  scores?: number[];
  message?: string;
  quality?: QualityResult;
}> {
  try {
    const result = await detectFacesAndGetDescriptors(source);
    if (!result.success) {
      return { success: false, message: result.message };
    }
    const maxScore = Math.max(...(result.scores || [1]));
    return {
      success: true,
      encodings: result.encodings,
      locations: result.locations,
      scores: result.scores,
      quality: {
        blurry: maxScore < 0.3,
        blur_score: Math.round(maxScore * 100),
        dark: false,
        brightness: 128,
        good_quality: maxScore >= 0.4,
        face_count: result.encodings!.length,
        max_detection_score: maxScore,
      },
    };
  } catch (err: any) {
    return { success: false, message: err.message || "Face processing failed" };
  }
}

export async function encodeAllFaces(
  imageBlob: Blob
): Promise<{
  success: boolean;
  encodings?: FaceEncoding[];
  locations?: number[][];
  scores?: number[];
  message?: string;
  quality?: QualityResult;
}> {
  try {
    const img = new Image();
    img.src = URL.createObjectURL(imageBlob);
    await ensureLoaded(img);
    if (!img.naturalWidth || !img.naturalHeight) {
      URL.revokeObjectURL(img.src);
      return { success: false, message: "Invalid image" };
    }
    const result = await detectFacesAndGetDescriptors(img);
    URL.revokeObjectURL(img.src);
    if (!result.success) {
      return { success: false, message: result.message };
    }
    const maxScore = Math.max(...(result.scores || [1]));
    return {
      success: true,
      encodings: result.encodings,
      locations: result.locations,
      scores: result.scores,
      quality: {
        blurry: maxScore < 0.3,
        blur_score: Math.round(maxScore * 100),
        dark: false,
        brightness: 128,
        good_quality: maxScore >= 0.4,
        face_count: result.encodings!.length,
        max_detection_score: maxScore,
      },
    };
  } catch (err: any) {
    return { success: false, message: err.message || "Face processing failed" };
  }
}

export async function encodeFace(
  imageBlob: Blob
): Promise<{
  success: boolean;
  encodings?: FaceEncoding[];
  message?: string;
  quality?: QualityResult;
}> {
  const result = await encodeAllFaces(imageBlob);
  if (result.success && result.encodings && result.encodings.length > 0) {
    return {
      success: true,
      encodings: [result.encodings[0]],
      message: result.message,
      quality: result.quality,
    };
  }
  return { success: false, message: result.message, quality: result.quality };
}

export async function detectFace(
  imageBlob: Blob
): Promise<{ count: number; locations?: number[][]; detection_scores?: number[] }> {
  try {
    const img = new Image();
    img.src = URL.createObjectURL(imageBlob);
    await ensureLoaded(img);
    const result = await detectFacesAndGetDescriptors(img);
    URL.revokeObjectURL(img.src);
    if (result.success && result.locations) {
      return {
        count: result.locations.length,
        locations: result.locations,
        detection_scores: result.scores,
      };
    }
    return { count: 0 };
  } catch {
    return { count: 0 };
  }
}

export async function checkQuality(imageBlob: Blob): Promise<QualityResult> {
  try {
    const img = new Image();
    img.src = URL.createObjectURL(imageBlob);
    await ensureLoaded(img);
    const result = await detectFacesAndGetDescriptors(img);
    URL.revokeObjectURL(img.src);
    const scores = result.scores || [];
    const maxScore = scores.length ? Math.max(...scores) : 0;
    return {
      blurry: maxScore < 0.3,
      blur_score: Math.round(maxScore * 100),
      dark: false,
      brightness: 128,
      good_quality: maxScore >= 0.4 && scores.length > 0,
      face_count: scores.length,
      max_detection_score: maxScore,
    };
  } catch {
    return { blurry: false, blur_score: 0, dark: false, brightness: 128, good_quality: false };
  }
}

export function computeDistance(a: FaceEncoding, b: FaceEncoding): number {
  if (!a || !b || a.length === 0 || b.length === 0) return Infinity;
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

export function matchLocal(
  known: FaceEncoding[],
  target: FaceEncoding,
  threshold = 0.6
): { matched: boolean; matchedIndex: number; similarity: number } {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < known.length; i++) {
    const d = computeDistance(known[i], target);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return {
    matched: bestDist <= threshold,
    matchedIndex: bestIdx,
    similarity: 1 / (1 + bestDist),
  };
}
