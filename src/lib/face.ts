"use client";

import { aiEncode, aiDetect, aiHealth, type EncodeResult } from "./aiService";

export type FaceEncoding = number[];

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
