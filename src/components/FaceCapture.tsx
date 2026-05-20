"use client";
import { useRef, useState, useCallback, useEffect } from "react";

interface Props {
  onCapture: (blob: Blob) => void;
}

export default function FaceCapture({ onCapture }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cam, setCam] = useState(false);
  const [ready, setReady] = useState(false);
  const [snap, setSnap] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = s;
      setCam(true);
    } catch { alert("Camera access denied"); }
  }, []);

  useEffect(() => {
    if (cam && video.current && streamRef.current) {
      video.current.srcObject = streamRef.current;
      video.current.play().then(async () => {
        for (let i = 0; i < 50; i++) {
          if (video.current!.videoWidth > 0 && video.current!.videoHeight > 0) break;
          await new Promise(r => setTimeout(r, 100));
        }
        setReady(true);
      }).catch(() => { setReady(true); });
    }
  }, [cam]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCam(false);
    setReady(false);
  }, []);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  const capture = () => {
    const v = video.current, c = canvas.current;
    if (!v || !c) return;
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 480;
    c.getContext("2d")!.drawImage(v, 0, 0);
    const url = c.toDataURL("image/jpeg", 0.92);
    setSnap(url);
    c.toBlob((b) => { if (b) onCapture(b); }, "image/jpeg", 0.92);
    stop();
  };

  if (snap) {
    return (
      <div>
        <img src={snap} alt="" style={{ width: "100%", borderRadius: 8 }} />
        <p style={{ fontSize: 13, color: "var(--success)", marginTop: 4 }}>✅ Captured</p>
        <button className="btn btn-sm" onClick={() => { setSnap(null); start(); }}>Retake</button>
      </div>
    );
  }

  return (
    <div>
      <video ref={video} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8, display: cam ? "block" : "none" }} />
      <canvas ref={canvas} style={{ display: "none" }} />
      {cam ? (
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button className="btn btn-success" onClick={capture} disabled={!ready}>📸 Capture Photo</button>
          <button className="btn btn-danger" onClick={stop}>Stop</button>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={start} style={{ marginTop: 8 }}>📷 Start Camera</button>
      )}
      {!ready && cam && <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>⏳ Camera starting...</p>}
    </div>
  );
}
