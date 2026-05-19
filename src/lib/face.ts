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
  }
  return faceapi;
}

async function ensureModels(): Promise<void> {
  if (modelsLoaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const api = await getFaceApi();
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

function imageBlobToElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
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
    const api = await getFaceApi();
    await ensureModels();
    const img = await imageBlobToElement(imageBlob);
    if (!img.width || !img.height) {
      return { success: false, message: "Invalid image" };
    }

    const opts = new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 });
    const results = await api
      .detectAllFaces(img, opts)
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
      return { success: false, message: "No face detected. Look directly at camera in good lighting." };
    }

    const maxScore = Math.max(...scores);
    const blurScore = Math.round(maxScore * 100);

    return {
      success: true,
      encodings,
      locations,
      scores,
      quality: {
        blurry: maxScore < 0.3,
        blur_score: blurScore,
        dark: false,
        brightness: 128,
        good_quality: maxScore >= 0.4,
        face_count: encodings.length,
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
    const api = await getFaceApi();
    await ensureModels();
    const img = await imageBlobToElement(imageBlob);
    const opts = new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 });
    const results = await api.detectAllFaces(img, opts).withFaceLandmarks();
    return {
      count: results.length,
      locations: results.map((r) => [r.detection.box.x, r.detection.box.y, r.detection.box.width, r.detection.box.height]),
      detection_scores: results.map((r) => r.detection.score),
    };
  } catch {
    return { count: 0 };
  }
}

export async function checkQuality(imageBlob: Blob): Promise<QualityResult> {
  try {
    const api = await getFaceApi();
    await ensureModels();
    const img = await imageBlobToElement(imageBlob);
    const results = await api.detectAllFaces(img, new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 }));
    const scores = results.map((r) => r.score);
    const maxScore = scores.length ? Math.max(...scores) : 0;
    return {
      blurry: maxScore < 0.3,
      blur_score: Math.round(maxScore * 100),
      dark: false,
      brightness: 128,
      good_quality: maxScore >= 0.4 && results.length > 0,
      face_count: results.length,
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
