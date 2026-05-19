"use client";

const AI_URL = "https://hrms-ai-abv8.onrender.com";

async function callAi<T>(
  endpoint: string,
  body: FormData | object
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const isForm = body instanceof FormData;
  try {
    const res = await fetch(`${AI_URL}${endpoint}`, {
      method: "POST",
      ...(isForm ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `AI ${res.status}: ${text}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (e: any) {
    if (e.name === "TimeoutError") return { ok: false, error: "AI service timeout (cold start)" };
    return { ok: false, error: e.message || "AI service unreachable" };
  }
}

export interface AiEncodeResult {
  success: boolean;
  encodings?: number[][];
  locations?: number[][];
  message?: string;
  quality?: {
    blurry: boolean;
    blur_score: number;
    dark: boolean;
    brightness: number;
    good_quality: boolean;
    face_count?: number;
  };
}

export async function aiEncodeFace(imageBlob: Blob): Promise<AiEncodeResult> {
  const fd = new FormData();
  fd.append("image", imageBlob, "frame.jpg");
  const result = await callAi<any>("/encode-face", fd);
  if (!result.ok) return { success: false, message: result.error };
  const d = result.data!;
  if (!d.success) return { success: false, message: d.message || "No face", quality: d.quality };
  return {
    success: true,
    encodings: d.encodings,
    locations: d.locations,
    message: `${d.faces} face(s) detected`,
    quality: d.quality,
  };
}

export async function aiCheckQuality(imageBlob: Blob): Promise<{
  blurry: boolean; blur_score: number; dark: boolean; brightness: number;
  good_quality: boolean; face_count: number;
}> {
  const fd = new FormData();
  fd.append("image", imageBlob, "frame.jpg");
  const result = await callAi<any>("/quality-check", fd);
  if (!result.ok || !result.data) {
    return { blurry: false, blur_score: 0, dark: false, brightness: 128, good_quality: false, face_count: 0 };
  }
  return result.data;
}

export async function aiWarmUp(): Promise<boolean> {
  try {
    const res = await fetch(`${AI_URL}/health`, { signal: AbortSignal.timeout(10000) });
    return res.ok;
  } catch {
    return false;
  }
}
