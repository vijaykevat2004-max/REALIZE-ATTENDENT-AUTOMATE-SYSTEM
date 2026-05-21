"use client";

// Auto-detect: use local AI service if available, fallback to cloud proxy
const LOCAL_API = "http://localhost:8000";
const CLOUD_API = "/api/ai";
let useLocal = true;

export interface QualityResult {
  score: number;
  blur: number;
  brightness: number;
  contrast: number;
  face_size: number;
  face_ratio: number;
  issues: string[];
  good_quality: boolean;
}

export interface EncodeResult {
  success: boolean;
  encodings?: number[][];
  message?: string;
  confidence?: number;
  quality?: QualityResult;
  embedding_dim?: number;
  locations?: number[][];
}

export interface MatchCandidate {
  employee_id: string;
  name: string;
  similarity: number;
}

export interface IndustryMatchResult {
  success: boolean;
  decision: "CONFIRMED" | "REVIEW" | "REJECT";
  reason: string;
  best_match: MatchCandidate | null;
  all_scores: MatchCandidate[];
  quality: QualityResult | null;
  detection_confidence: number;
  temporal: {
    verified: boolean;
    avg_similarity: number;
    frame_count: number;
    required_frames: number;
  };
  margin: number;
  message?: string;
}

async function getApi(): Promise<string> {
  if (useLocal) {
    try {
      const res = await fetch(`${LOCAL_API}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return LOCAL_API;
    } catch {
      useLocal = false;
    }
  }
  return CLOUD_API;
}

export async function aiEncode(blob: Blob): Promise<EncodeResult> {
  const fd = new FormData();
  fd.append("image", blob, "face.jpg");
  try {
    const api = await getApi();
    const res = await fetch(`${api}/encode-face`, { method: "POST", body: fd, signal: AbortSignal.timeout(25000) });
    const data = await res.json();
    if (!res.ok || !data.success) return { success: false, message: data.message || `Server ${res.status}` };
    return {
      success: true,
      encodings: data.encodings,
      message: `Face detected (${data.confidence}% conf)`,
      confidence: data.confidence,
      quality: data.quality,
      embedding_dim: data.embedding_dim,
      locations: data.locations,
    };
  } catch (e: any) {
    return { success: false, message: e.name === "TimeoutError" ? "AI service timeout" : e.message };
  }
}

export async function aiIndustryMatch(imageBlob: Blob, knownEmbeddings: Array<{employee_id: string, name: string, embedding: number[]}>, sessionId: string): Promise<IndustryMatchResult> {
  // Convert image to base64 and send as JSON
  const reader = new FileReader();
  const base64Promise = new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(imageBlob);
  });
  
  try {
    const base64 = await base64Promise;
    const api = await getApi();
    const res = await fetch(`${api}/industry-match-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: base64,
        known_embeddings: knownEmbeddings,
        session_id: sessionId,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        decision: "REJECT",
        reason: data.reason || data.message || "Match failed",
        best_match: null,
        all_scores: [],
        quality: null,
        detection_confidence: 0,
        temporal: { verified: false, avg_similarity: 0, frame_count: 0, required_frames: 5 },
        margin: 0,
        message: data.message,
      };
    }
    return data as IndustryMatchResult;
  } catch (e: any) {
    return {
      success: false,
      decision: "REJECT",
      reason: e.name === "TimeoutError" ? "AI service timeout" : e.message,
      best_match: null,
      all_scores: [],
      quality: null,
      detection_confidence: 0,
      temporal: { verified: false, avg_similarity: 0, frame_count: 0, required_frames: 5 },
      margin: 0,
    };
  }
}

export async function aiDetect(blob: Blob): Promise<{ count: number; locations?: number[][]; faces?: any[] }> {
  const fd = new FormData();
  fd.append("image", blob, "face.jpg");
  try {
    const api = await getApi();
    const res = await fetch(`${api}/detect`, { method: "POST", body: fd, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { count: 0 };
    return await res.json();
  } catch { return { count: 0 }; }
}

export async function aiHealth(): Promise<boolean> {
  try {
    const api = await getApi();
    const res = await fetch(`${api}/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch { return false; }
}

export const aiWarmUp = aiHealth;
