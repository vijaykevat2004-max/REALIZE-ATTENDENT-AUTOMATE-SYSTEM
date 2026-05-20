"use client";

const API = "/api/ai";

export interface QualityResult {
  score: number;
  blur: number;
  brightness: number;
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

export interface AdvancedMatchResult {
  classification: "CONFIRMED" | "REVIEW" | "REJECT";
  reason: string;
  confidence_score: number;
  cosine_similarity: number;
  quality_score: number;
  margin: number;
  second_best_similarity: number;
  temporal: {
    consistency: number;
    frame_count: number;
    avg_similarity: number;
    std_deviation: number;
    verified: boolean;
  };
  thresholds: {
    base: number;
    confirmed: number;
    review: number;
    margin_min: number;
  };
  matched_employee: {
    id: string;
    name: string | null;
    index: number;
  } | null;
  top_scores: MatchCandidate[];
  quality_gate_passed: boolean;
  processing_time_ms: number;
}

export async function aiEncode(blob: Blob): Promise<EncodeResult> {
  const fd = new FormData();
  fd.append("image", blob, "face.jpg");
  try {
    const res = await fetch(`${API}/encode-face`, { method: "POST", body: fd, signal: AbortSignal.timeout(25000) });
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

export async function aiAdvancedMatch(payload: {
  known_embeddings: number[][];
  known_ids: string[];
  known_names: string[];
  target_embedding: number[];
  quality_score: number;
  session_id: string;
  num_enrolled: number;
}): Promise<AdvancedMatchResult> {
  try {
    const res = await fetch(`${API}/advanced-match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok) {
      return {
        classification: "REJECT",
        reason: data.reason || `Server error ${res.status}`,
        confidence_score: 0,
        cosine_similarity: 0,
        quality_score: 0,
        margin: 0,
        second_best_similarity: 0,
        temporal: { consistency: 0, frame_count: 0, avg_similarity: 0, std_deviation: 0, verified: false },
        thresholds: { base: 0, confirmed: 0, review: 0, margin_min: 0 },
        matched_employee: null,
        top_scores: [],
        quality_gate_passed: false,
        processing_time_ms: 0,
      };
    }
    return data as AdvancedMatchResult;
  } catch (e: any) {
    return {
      classification: "REJECT",
      reason: e.name === "TimeoutError" ? "AI service timeout" : e.message,
      confidence_score: 0,
      cosine_similarity: 0,
      quality_score: 0,
      margin: 0,
      second_best_similarity: 0,
      temporal: { consistency: 0, frame_count: 0, avg_similarity: 0, std_deviation: 0, verified: false },
      thresholds: { base: 0, confirmed: 0, review: 0, margin_min: 0 },
      matched_employee: null,
      top_scores: [],
      quality_gate_passed: false,
      processing_time_ms: 0,
    };
  }
}

export async function aiDetect(blob: Blob): Promise<{ count: number; locations?: number[][]; faces?: any[] }> {
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
