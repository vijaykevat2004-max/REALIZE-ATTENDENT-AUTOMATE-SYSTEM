"use client";

const AI_SERVICE_URL = process.env.NEXT_PUBLIC_AI_SERVICE_URL || "https://hrms-ai-service.onrender.com";

export type FaceEncoding = number[];

export async function encodeFace(imageBlob: Blob): Promise<{ success: boolean; encodings?: FaceEncoding[]; message?: string }> {
  try {
    const form = new FormData();
    form.append("image", imageBlob, "face.jpg");
    const res = await fetch(`${AI_SERVICE_URL}/encode-face`, { method: "POST", body: form });
    if (!res.ok) return { success: false, message: "AI service unavailable" };
    return await res.json();
  } catch {
    return { success: false, message: "AI service unreachable" };
  }
}

export async function matchFace(
  knownEncodings: FaceEncoding[],
  targetEncoding: FaceEncoding,
  threshold = 0.55
): Promise<{ matched: boolean; matchedIndex: number; confidence: number } | null> {
  try {
    const res = await fetch(`${AI_SERVICE_URL}/match-face`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ known_embeddings: knownEncodings, target_embedding: targetEncoding, threshold }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function detectFace(imageBlob: Blob): Promise<{ count: number; locations?: number[][] }> {
  try {
    const form = new FormData();
    form.append("image", imageBlob, "face.jpg");
    const res = await fetch(`${AI_SERVICE_URL}/detect-faces`, { method: "POST", body: form });
    if (!res.ok) return { count: 0 };
    return await res.json();
  } catch {
    return { count: 0 };
  }
}

export function computeDistance(a: FaceEncoding, b: FaceEncoding): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

export function matchLocal(known: FaceEncoding[], target: FaceEncoding, threshold = 0.55): { matched: boolean; matchedIndex: number; confidence: number } {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < known.length; i++) {
    const d = computeDistance(known[i], target);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return {
    matched: bestDist <= threshold,
    matchedIndex: bestIdx,
    confidence: 1 / (1 + bestDist),
  };
}
