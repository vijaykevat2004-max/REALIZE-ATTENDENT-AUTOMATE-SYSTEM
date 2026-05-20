"use client";

import { aiEncode, aiDetect, aiHealth, aiAdvancedMatch, type AdvancedMatchResult, type EncodeResult } from "./aiService";

export type FaceEncoding = number[];

export interface MatchDecision {
  classification: "CONFIRMED" | "REVIEW" | "REJECT";
  employeeId?: string;
  employeeName?: string;
  confidenceScore: number;
  cosineSimilarity: number;
  qualityScore: number;
  margin: number;
  reason: string;
  temporalVerified: boolean;
  temporalFrameCount: number;
  processingTimeMs: number;
  topScores: { employee_id: string; name: string; similarity: number }[];
}

let warmed = false;
async function warm() {
  if (warmed) return;
  warmed = true;
  aiHealth().catch(() => {});
}

export async function encodeFace(blob: Blob): Promise<EncodeResult> {
  await warm();
  return aiEncode(blob);
}

export async function detectFaces(blob: Blob) {
  return aiDetect(blob);
}

export async function encodeAllFacesFromVideo(source: HTMLVideoElement | HTMLCanvasElement) {
  await warm();
  const canvas = source instanceof HTMLCanvasElement ? source : document.createElement("canvas");
  if (source instanceof HTMLVideoElement) {
    canvas.width = source.videoWidth || 640;
    canvas.height = source.videoHeight || 480;
    canvas.getContext("2d")!.drawImage(source, 0, 0);
  }
  return new Promise<EncodeResult>((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob || blob.size === 0) return resolve({ success: false, message: "No frame" });
      const r = await aiEncode(blob);
      resolve(r);
    }, "image/jpeg", 0.92);
  });
}

export function computeDistance(a: FaceEncoding, b: FaceEncoding): number {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

export function assessClientQuality(
  video: HTMLVideoElement,
  faceBox: { x: number; y: number; w: number; h: number } | null,
): { score: number; issues: string[]; good: boolean } {
  const issues: string[] = [];
  let score = 1.0;

  if (faceBox) {
    const faceSize = Math.max(faceBox.w, faceBox.h);
    if (faceSize < 60) {
      issues.push("face_too_small");
      score -= 0.3;
    }
    const videoArea = video.videoWidth * video.videoHeight;
    const faceArea = faceBox.w * faceBox.h;
    const ratio = faceArea / Math.max(videoArea, 1);
    if (ratio < 0.05) {
      issues.push("face_too_far");
      score -= 0.2;
    }
    if (ratio > 0.70) {
      issues.push("face_too_close");
      score -= 0.1;
    }
  }

  score = Math.max(0, score);
  return { score: Math.round(score * 100) / 100, issues, good: issues.length === 0 };
}

export async function matchFaceServer(params: {
  targetEmbedding: number[];
  qualityScore: number;
  sessionId: string;
  knownEmployees: Array<{ id: string; name: string; encoding: number[] }>;
}): Promise<MatchDecision> {
  if (params.knownEmployees.length === 0) {
    return {
      classification: "REJECT",
      confidenceScore: 0,
      cosineSimilarity: 0,
      qualityScore: 0,
      margin: 0,
      reason: "No enrolled employees to match against",
      temporalVerified: false,
      temporalFrameCount: 0,
      processingTimeMs: 0,
      topScores: [],
    };
  }

  const result = await aiAdvancedMatch({
    known_embeddings: params.knownEmployees.map((e) => e.encoding),
    known_ids: params.knownEmployees.map((e) => e.id),
    known_names: params.knownEmployees.map((e) => e.name),
    target_embedding: params.targetEmbedding,
    quality_score: params.qualityScore,
    session_id: params.sessionId,
    num_enrolled: params.knownEmployees.length,
  });

  return {
    classification: result.classification,
    employeeId: result.matched_employee?.id,
    employeeName: result.matched_employee?.name || undefined,
    confidenceScore: result.confidence_score,
    cosineSimilarity: result.cosine_similarity,
    qualityScore: result.quality_score,
    margin: result.margin,
    reason: result.reason,
    temporalVerified: result.temporal.verified,
    temporalFrameCount: result.temporal.frame_count,
    processingTimeMs: result.processing_time_ms,
    topScores: result.top_scores,
  };
}
