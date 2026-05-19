"use client";
import { useRef, useState, useCallback, useEffect } from "react";

interface FaceCaptureProps {
  onCapture: (imageBlob: Blob) => void;
  width?: number;
  height?: number;
  continuous?: boolean;
  captureInterval?: number;
}

export default function FaceCapture({ onCapture, width = 320, height = 240, continuous = false, captureInterval = 3000 }: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState<"idle" | "scanning" | "detected" | "captured">("idle");
  const [quality, setQuality] = useState({ blur: 0, bright: 128, faceCount: 0, good: false });
  const lastCheck = useRef(0);

  const startCamera = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width, height, facingMode: "user" } });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
      setActive(true);
      setStatus("scanning");
    } catch { alert("Camera access denied"); }
  }, [width, height]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setActive(false);
    setStatus("idle");
  }, [stream]);

  const grabFrame = useCallback((): Blob | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    const vw = video.videoWidth || width;
    const vh = video.videoHeight || height;
    if (vw === 0 || vh === 0) return null;
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    let blob: Blob | null = null;
    canvas.toBlob((b) => { blob = b; }, "image/jpeg", 0.85);
    return blob;
  }, [width, height]);

  const checkFrame = useCallback(async () => {
    const blob = grabFrame();
    if (!blob) return;
    try {
      const fd = new FormData();
      fd.append("image", blob, "frame.jpg");
      const res = await fetch("/api/ai/quality-check", { method: "POST", body: fd, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = await res.json();
      setQuality({ blur: data.blur_score ?? 0, bright: data.brightness ?? 128, faceCount: data.face_count ?? 0, good: data.good_quality === true });
      if (data.face_count > 0 && data.good_quality) {
        setStatus("detected");
        if (!continuous) {
          setStatus("captured");
          onCapture(blob);
          return;
        }
      } else if (data.face_count > 0) {
        setStatus("scanning");
      } else {
        setStatus("scanning");
      }
    } catch { /* ignore check failures */ }
  }, [grabFrame, onCapture, continuous]);

  useEffect(() => {
    if (!active) return;
    let running = true;
    const loop = async () => {
      while (running) {
        const now = Date.now();
        const interval = continuous ? captureInterval : 1000;
        if (now - lastCheck.current >= interval) {
          lastCheck.current = now;
          if (continuous) {
            const blob = grabFrame();
            if (blob) onCapture(blob);
          } else if (status !== "captured") {
            await checkFrame();
          }
        }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    loop();
    return () => { running = false; };
  }, [active, continuous, captureInterval, checkFrame, grabFrame, onCapture, status]);

  useEffect(() => {
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [stream]);

  const indicatorColor = status === "captured" ? "#22c55e" : status === "detected" ? "#22d3ee" : quality.faceCount > 0 ? "#facc15" : "#6b7280";
  const statusText = status === "captured" ? "Face Captured ✅" : status === "detected" ? "Good Face! ✓" : quality.faceCount > 0 ? "Adjust lighting..." : "Look at camera";

  return (
    <div className="camera-wrap">
      <div style={{ position: "relative" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8 }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        {active && (
          <div style={{ position: "absolute", bottom: 8, left: 8, right: 8, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}>
            <span>👤 {quality.faceCount > 0 ? `${quality.faceCount} face` : "no face"}</span>
            <span>{quality.blur > 0 ? `📷 ${quality.blur.toFixed(0)}` : ""}</span>
            <span>☀️ {quality.bright.toFixed(0)}</span>
          </div>
        )}
      </div>
      {active && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, padding: "4px 8px", borderRadius: 4, background: indicatorColor + "22", border: "1px solid " + indicatorColor }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: indicatorColor, flexShrink: 0 }} />
          <span style={{ fontSize: 13, flex: 1 }}>{statusText}</span>
          {status === "captured" && <button className="btn btn-sm" onClick={() => setStatus("scanning")} style={{ fontSize: 11 }}>Retake</button>}
        </div>
      )}
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        {!active ? (
          <button className="btn btn-primary" onClick={startCamera}>📷 Start Camera</button>
        ) : (
          <button className="btn btn-danger" onClick={stopCamera}>Stop Camera</button>
        )}
      </div>
    </div>
  );
}
