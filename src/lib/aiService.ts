"use client";

const AI_URL = "/api/ai";

async function callAi<T>(
  endpoint: string,
  body: FormData | object
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const isForm = body instanceof FormData;
  const isGet = endpoint === "/health";
  try {
    const res = await fetch(`${AI_URL}${endpoint}`, {
      method: isGet ? "GET" : "POST",
      ...(isForm ? { body } : isGet ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `AI ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (e: any) {
    const msg = e.name === "TimeoutError" ? "AI service timeout (cold start taking too long)" : e.message || "AI service unreachable";
    console.error(`[aiService] ${endpoint} failed:`, msg);
    return { ok: false, error: msg };
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
    const res = await fetch(`${AI_URL}/health`, { signal: AbortSignal.timeout(15000) });
    return res.ok;
  } catch (e) {
    console.warn("[aiService] warm-up failed:", e);
    return false;
  }
}
