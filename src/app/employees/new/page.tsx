"use client";
import { useState, useRef, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import Link from "next/link";

const AI_URL = "https://hrms-ai-abv8.onrender.com";

function EmployeeForm() {
  const { token } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", department: "", shiftType: "GENERAL",
  });
  const [faceStatus, setFaceStatus] = useState<"idle" | "encoding" | "done" | "error">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [qualityInfo, setQualityInfo] = useState<{ blurry?: boolean; dark?: boolean; score?: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: "user" } });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch { console.log("Camera not available"); }
    })();
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []);

  const capturePhoto = (): Promise<string> => new Promise((resolve) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) { resolve(""); return; }
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) { resolve(""); return; }
    ctx.drawImage(video, 0, 0);
    resolve(canvas.toDataURL("image/jpeg", 0.9));
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      const photoDataUrl = await capturePhoto();
      if (!photoDataUrl) { setError("Camera not available"); setSaving(false); return; }
      setPreview(photoDataUrl);

      const blob = await (await fetch(photoDataUrl)).blob();
      const fd = new FormData();
      fd.append("image", blob, "face.jpg");

      setFaceStatus("encoding");
      const encRes = await fetch(`${AI_URL}/encode-face?min_det_score=0.4`, { method: "POST", body: fd });
      if (!encRes.ok) throw new Error("AI service unavailable");
      const encData = await encRes.json();
      const q = encData.quality;
      setQualityInfo({ blurry: q?.blurry, dark: q?.dark, score: encData.detection_scores?.[0] });
      if (!encData.success || !encData.encodings?.length) {
        if (q?.blurry) throw new Error("Photo too blurry. Hold still and try again.");
        if (q?.dark) throw new Error("Too dark. Move to better lighting.");
        throw new Error("No face detected. Look directly at camera in good lighting.");
      }
      const embedding = JSON.stringify(encData.encodings[0]);

      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, photoUrl: photoDataUrl, faceEmbedding: embedding }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to save");
      }
      setFaceStatus("done");
      setTimeout(() => router.push("/employees"), 1500);
    } catch (err: any) {
      setError(err.message);
      setFaceStatus("error");
    }
    setSaving(false);
  };

  const fields = [
    { label: "First Name", key: "firstName", required: true },
    { label: "Last Name", key: "lastName", required: true },
    { label: "Email", key: "email", type: "email", required: true },
    { label: "Department", key: "department" },
    { label: "Shift", key: "shiftType", type: "select", options: ["GENERAL", "MORNING", "NIGHT"] },
  ];

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Add Employee</h1>
          <Link href="/employees" className="btn btn-outline">← Back</Link>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {faceStatus === "done" && <div className="alert alert-success">✅ Employee created with face enrollment! Redirecting...</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "start" }}>
          <div className="card">
            <form onSubmit={handleSubmit}>
              <div className="grid-3">
                {fields.map((f) => (
                  <div className="form-group" key={f.key}>
                    <label>{f.label}</label>
                    {f.type === "select" ? (
                      <select className="form-control" value={(form as any)[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                        {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : f.type === "textarea" ? (
                      <textarea className="form-control" value={(form as any)[f.key]} onChange={(e) => set(f.key, e.target.value)} />
                    ) : (
                      <input type={f.type || "text"} className="form-control" placeholder={f.label} value={(form as any)[f.key]} onChange={(e) => set(f.key, e.target.value)} required={f.required} />
                    )}
                  </div>
                ))}
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving || faceStatus === "encoding"} style={{ marginTop: 16 }}>
                {saving || faceStatus === "encoding" ? "Processing..." : "Create Employee with Face"}
              </button>
            </form>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Face Capture</h3>
            <div className="camera-wrap">
              {preview ? (
                <img src={preview} alt="Captured" style={{ width: "100%", borderRadius: 8 }} />
              ) : (
                <>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8 }} />
                  <div style={{ position: "absolute", bottom: 8, left: 8, right: 8, textAlign: "center" }}>
                    <span style={{ background: "rgba(0,0,0,0.6)", color: "#94a3b8", padding: "4px 12px", borderRadius: 4, fontSize: 12 }}>
                      Camera active — face will be captured on submit
                    </span>
                  </div>
                </>
              )}
              <canvas ref={canvasRef} style={{ display: "none" }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {faceStatus === "idle" && <p>📸 Look at camera. Face is captured automatically when you click Create.</p>}
              {faceStatus === "encoding" && <p>⏳ Encoding face with AI... One moment.</p>}
              {faceStatus === "error" && (
                <div>
                  <p style={{ color: "var(--danger)" }}>❌ {error}</p>
                  {qualityInfo?.blurry && <p style={{ color: "var(--warning)" }}>⚠️ Photo was blurry — hold still next time</p>}
                  {qualityInfo?.dark && <p style={{ color: "var(--warning)" }}>⚠️ Scene too dark — move to brighter area</p>}
                  {qualityInfo?.score !== undefined && qualityInfo.score < 0.5 && <p style={{ color: "var(--warning)" }}>⚠️ Low face confidence ({Math.round(qualityInfo.score * 100)}%) — try facing directly at camera</p>}
                </div>
              )}
              {faceStatus === "done" && <p style={{ color: "var(--success)" }}>✅ Face enrolled! You&apos;ll be recognized every time at the kiosk.</p>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Page() {
  return <AuthProvider><EmployeeForm /></AuthProvider>;
}
