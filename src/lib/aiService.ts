"use client";

const API = "/api/ai";

export async function aiEncode(blob: Blob): Promise<{
  success: boolean; encodings?: number[][]; message?: string; confidence?: number;
  quality?: { blurry: boolean; blur_score: number; good_quality: boolean };
  embedding_dim?: number;
}> {
  const fd = new FormData();
  fd.append("image", blob, "face.jpg");
  try {
    const res = await fetch(`${API}/encode-face`, { method: "POST", body: fd, signal: AbortSignal.timeout(25000) });
    const data = await res.json();
    if (!res.ok || !data.success) return { success: false, message: data.message || `Server ${res.status}` };
    return {
      success: true, encodings: data.encodings, message: `Face detected (${data.confidence}% conf)`,
      confidence: data.confidence, quality: data.quality, embedding_dim: data.embedding_dim,
    };
  } catch (e: any) {
    return { success: false, message: e.name === "TimeoutError" ? "AI service timeout" : e.message };
  }
}

export async function aiDetect(blob: Blob): Promise<{ count: number; locations?: number[][] }> {
  const fd = new FormData();
  fd.append("image", blob, "face.jpg");
  try {
    const res = await fetch(`${API}/detect`, { method: "POST", body: fd, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { count: 0 };
    return await res.json();
  } catch { return { count: 0 }; }
}

export async function aiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch { return false; }
}

export const aiWarmUp = aiHealth;
