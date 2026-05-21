"use client";
import { useState, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import FaceCapture from "@/components/FaceCapture";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { aiEncodeMulti } from "@/lib/aiService";

function EmployeeForm() {
  const { token } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", mobile: "", department: "" });
  const [blobs, setBlobs] = useState<Blob[]>([]);
  const [faceStatus, setFaceStatus] = useState<"idle" | "encoding" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [qualityInfo, setQualityInfo] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fields = [
    { label: "First Name", key: "firstName", required: true },
    { label: "Last Name", key: "lastName", required: true },
    { label: "Email", key: "email", type: "email", required: true },
    { label: "Mobile", key: "mobile", type: "tel" },
    { label: "Department", key: "department" },
  ];

  const captureFace = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (!video.videoWidth || !video.videoHeight) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    
    canvas.toBlob((blob) => {
      if (blob) {
        setBlobs(prev => [...prev, blob]);
        setCaptureCount(prev => prev + 1);
      }
    }, "image/jpeg", 0.92);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (blobs.length < 3) {
        setError(`Need at least 3 face captures. Currently have ${blobs.length}.`);
        setSaving(false);
        return;
      }
      setFaceStatus("encoding");
      const enc = await aiEncodeMulti(blobs);
      if (!enc.success || !enc.encodings?.length) throw new Error(enc.message || "No face detected in captures");
      
      setQualityInfo(`Used ${enc.images_used}/${enc.images_total} images, avg quality: ${(enc.avg_quality || 0).toFixed(2)}`);
      
      const today = new Date().toISOString().split("T")[0];
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          firstName: form.firstName, lastName: form.lastName, email: form.email,
          mobile: form.mobile || `emp-${Date.now()}`, department: form.department || "General",
          designation: form.department || "Staff", joinDate: today, shiftType: "GENERAL",
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      const emp = await res.json();
      const faceRes = await fetch(`/api/employees/face/${emp.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ faceEmbedding: JSON.stringify(enc.encodings[0]) }),
      });
      if (!faceRes.ok) throw new Error("Face save failed");
      setFaceStatus("done");
      setTimeout(() => router.push("/employees"), 1500);
    } catch (err: any) { setError(err.message); setFaceStatus("error"); }
    setSaving(false);
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Add Employee</h1>
          <Link href="/employees" className="btn btn-outline">← Back</Link>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {faceStatus === "done" && <div className="alert alert-success">✅ Employee created! Redirecting...</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
          <div className="card">
            <form onSubmit={handleSubmit}>
              <div className="grid-3">
                {fields.map((f) => (
                  <div className="form-group" key={f.key}>
                    <label>{f.label}</label>
                    <input type={f.type || "text"} className="form-control" placeholder={f.label}
                      value={(form as any)[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} required={f.required} />
                  </div>
                ))}
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving || faceStatus === "encoding"} style={{ marginTop: 16 }}>
                {saving || faceStatus === "encoding" ? "Processing..." : "Create Employee"}
              </button>
            </form>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>📸 Multi-Image Enrollment ({blobs.length}/5)</h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
              Capture 5 photos from different angles for best accuracy
            </p>
            <div style={{ position: "relative" }}>
              <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8 }} />
              <canvas ref={canvasRef} style={{ display: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn btn-primary" onClick={captureFace} disabled={blobs.length >= 5}>
                📸 Capture ({5 - blobs.length} left)
              </button>
              <button className="btn btn-outline" onClick={() => { setBlobs([]); setCaptureCount(0); }}>
                🔄 Reset
              </button>
            </div>
            {qualityInfo && <p style={{ fontSize: 12, marginTop: 4, color: "var(--success)" }}>{qualityInfo}</p>}
            {blobs.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", gap: 4 }}>
                {blobs.map((_, i) => (
                  <div key={i} style={{ width: 40, height: 40, borderRadius: 4, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#fff" }}>
                    {i + 1}
                  </div>
                ))}
              </div>
            )}
            {faceStatus === "encoding" && <p style={{ fontSize: 12, marginTop: 4 }}>⏳ AI encoding faces...</p>}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Page() {
  return <AuthProvider><EmployeeForm /></AuthProvider>;
}
