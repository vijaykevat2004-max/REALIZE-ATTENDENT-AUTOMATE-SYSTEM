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
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [detected, setDetected] = useState(false);
  const intervalRef = useRef<any>(null);

  const startCamera = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width, height, facingMode: "user" } });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
      setActive(true);
    } catch { alert("Camera access denied"); }
  }, [width, height]);

  const stopCamera = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setActive(false);
  }, [stream]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || width;
    canvas.height = video.videoHeight || height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => { if (blob) onCapture(blob); }, "image/jpeg", 0.9);
    setDetected(true);
    setTimeout(() => setDetected(false), 500);
  }, [onCapture, width, height]);

  useEffect(() => {
    if (active && continuous) {
      intervalRef.current = setInterval(capture, captureInterval);
      return () => clearInterval(intervalRef.current);
    }
  }, [active, continuous, capture, captureInterval]);

  useEffect(() => {
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [stream]);

  return (
    <div className="camera-wrap">
      <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8 }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      {detected && <div className="camera-overlay"><span style={{ color: "#22d3ee", fontSize: 48 }}>◉</span></div>}
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        {!active ? (
          <button className="btn btn-primary" onClick={startCamera}>📷 Start Camera</button>
        ) : (
          <>
            {!continuous && <button className="btn btn-success" onClick={capture}>📸 Capture</button>}
            <button className="btn btn-danger" onClick={stopCamera}>Stop Camera</button>
          </>
        )}
      </div>
    </div>
  );
}
