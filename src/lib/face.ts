"use client";

import { aiEncodeFace, aiCheckQuality, aiWarmUp } from "./aiService";

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

// Warm up AI service on first call
let warmedUp = false;
async function ensureAi(): Promise<void> {
  if (warmedUp) return;
  warmedUp = true;
  await aiWarmUp();
}

export function getLoadingStatus(): string {
  return "";
}

async function blobFromSource(
  source: HTMLVideoElement | HTMLCanvasElement | Blob
): Promise<Blob> {
  if (source instanceof Blob) return source;
  const canvas = source instanceof HTMLCanvasElement ? source : document.createElement("canvas");
  if (source instanceof HTMLVideoElement) {
    canvas.width = source.videoWidth || 640;
    canvas.height = source.videoHeight || 480;
    canvas.getContext("2d")!.drawImage(source, 0, 0);
  }
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob([])), "image/jpeg", 0.92);
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
  await ensureAi();
  const result = await aiEncodeFace(imageBlob);
  if (!result.success) {
    return { success: false, message: result.message || "AI service unavailable" };
  }
  const q = result.quality;
  return {
    success: true,
    encodings: result.encodings,
    locations: result.locations,
    scores: result.encodings!.map(() => 1.0),
    quality: {
      blurry: q?.blurry || false,
      blur_score: q?.blur_score || 0,
      dark: q?.dark || false,
      brightness: q?.brightness || 128,
      good_quality: q?.good_quality || false,
      face_count: result.encodings!.length,
      max_detection_score: 1.0,
    },
  };
}

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
  await ensureAi();
  const blob = await blobFromSource(source);
  if (blob.size === 0) return { success: false, message: "Failed to capture frame" };
  return encodeAllFaces(blob);
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
  const result = await encodeAllFaces(imageBlob);
  if (result.success && result.locations) {
    return {
      count: result.locations.length,
      locations: result.locations,
      detection_scores: result.scores,
    };
  }
  return { count: 0 };
}

export async function checkQuality(imageBlob: Blob): Promise<QualityResult> {
  const q = await aiCheckQuality(imageBlob);
  return {
    blurry: q.blurry,
    blur_score: q.blur_score,
    dark: q.dark,
    brightness: q.brightness,
    good_quality: q.good_quality,
    face_count: q.face_count,
    max_detection_score: q.face_count > 0 ? 1.0 : 0,
  };
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
