"use client";

const AI_URL = "https://hrms-ai-abv8.onrender.com";

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

export async function encodeFace(
  imageBlob: Blob,
  minDetScore = 0.4
): Promise<{
  success: boolean;
  encodings?: FaceEncoding[];
  message?: string;
  quality?: QualityResult;
  detection_scores?: number[];
}> {
  try {
    const form = new FormData();
    form.append("image", imageBlob, "face.jpg");
    const res = await fetch(`${AI_URL}/encode-face?min_det_score=${minDetScore}`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) return { success: false, message: "AI service unavailable" };
    return await res.json();
  } catch {
    return { success: false, message: "AI service unreachable" };
  }
}

export async function matchFace(
  knownEncodings: FaceEncoding[],
  targetEncoding: FaceEncoding,
  threshold = 0.35
): Promise<{ matched: boolean; matchedIndex: number; similarity: number } | null> {
  try {
    const res = await fetch(`${AI_URL}/match-face`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        known_embeddings: knownEncodings,
        target_embedding: targetEncoding,
        threshold,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function detectFace(
  imageBlob: Blob
): Promise<{ count: number; locations?: number[][]; detection_scores?: number[] }> {
  try {
    const form = new FormData();
    form.append("image", imageBlob, "face.jpg");
    const res = await fetch(`${AI_URL}/detect-faces`, { method: "POST", body: form });
    if (!res.ok) return { count: 0 };
    return await res.json();
  } catch {
    return { count: 0 };
  }
}

export async function checkQuality(
  imageBlob: Blob
): Promise<QualityResult> {
  try {
    const form = new FormData();
    form.append("image", imageBlob, "face.jpg");
    const res = await fetch(`${AI_URL}/quality-check`, { method: "POST", body: form });
    if (!res.ok) return { blurry: false, blur_score: 0, dark: false, brightness: 128, good_quality: false };
    return await res.json();
  } catch {
    return { blurry: false, blur_score: 0, dark: false, brightness: 128, good_quality: false };
  }
}

export function computeDistance(a: FaceEncoding, b: FaceEncoding): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

export function matchLocal(
  known: FaceEncoding[],
  target: FaceEncoding,
  threshold = 0.7
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
