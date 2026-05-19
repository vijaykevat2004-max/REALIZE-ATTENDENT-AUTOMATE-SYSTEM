"use client";
import { useEffect, useState, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

function EditEmployeeContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [form, setForm] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (token && id) {
      fetch(`/api/employees/${id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data) {
            const { salaryConfig, attendanceLogs, leaveBalances, leaveRequests, payrollRecords, ...rest } = data;
            setForm(rest);
          }
        })
        .catch(() => {});
    }
  }, [token, id]);

  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/employees/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to update");
      }
      router.push("/employees");
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  };

  if (authLoading || !form) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  const fields = [
    { label: "First Name", key: "firstName", required: true },
    { label: "Last Name", key: "lastName", required: true },
    { label: "Email", key: "email", type: "email", required: true },
    { label: "Mobile", key: "mobile" },
    { label: "Aadhaar", key: "aadhaar" },
    { label: "PAN", key: "pan" },
    { label: "Gender", key: "gender", type: "select", options: ["MALE", "FEMALE", "OTHER"] },
    { label: "Marital Status", key: "maritalStatus", type: "select", options: ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"] },
    { label: "Date of Birth", key: "dateOfBirth", type: "date" },
    { label: "Blood Group", key: "bloodGroup" },
    { label: "Address", key: "address", type: "textarea" },
    { label: "City", key: "city" },
    { label: "State", key: "state" },
    { label: "Pincode", key: "pincode" },
    { label: "Emergency Contact", key: "emergencyContact" },
    { label: "Emergency Phone", key: "emergencyPhone" },
    { label: "Bank Name", key: "bankName" },
    { label: "Bank Account", key: "bankAccount" },
    { label: "Bank IFSC", key: "bankIfsc" },
    { label: "Department", key: "department" },
    { label: "Designation", key: "designation" },
    { label: "Shift Type", key: "shiftType", type: "select", options: ["GENERAL", "MORNING", "NIGHT"] },
    { label: "Join Date", key: "joinDate", type: "date" },
    { label: "Status", key: "status", type: "select", options: ["ACTIVE", "INACTIVE", "TERMINATED"] },
  ];

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Edit Employee</h1>
          <Link href="/employees" className="btn btn-outline">← Back</Link>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="grid-3">
              {fields.map((f) => (
                <div className="form-group" key={f.key}>
                  <label>{f.label}</label>
                  {f.type === "select" ? (
                    <select className="form-control" value={(form as any)[f.key] || ""} onChange={(e) => set(f.key, e.target.value)}>
                      {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea className="form-control" value={(form as any)[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} />
                  ) : (
                    <input type={f.type || "text"} className="form-control" value={(form as any)[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} required={f.required} />
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving..." : "Update Employee"}
              </button>
              <button type="button" className="btn btn-danger" onClick={async () => {
                if (!confirm("Deactivate this employee?")) return;
                await fetch(`/api/employees/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
                router.push("/employees");
              }}>Deactivate</button>
            </div>
          </form>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>Face Enrollment</h3>
          <FaceEnroll employeeId={id} token={token} />
        </div>
      </main>
    </div>
  );
}

function FaceEnroll({ employeeId, token }: { employeeId: string; token: string | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [capturedImg, setCapturedImg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (token && employeeId) {
      fetch(`/api/employees/face/${employeeId}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.hasFace) setEnrolled(true); });
    }
  }, [token, employeeId]);

  const start = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: "user" } });
      setStream(s);
      setActive(true);
    } catch { setMessage("Camera access denied"); }
  };

  const stop = () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setActive(false);
    setCapturedImg(null);
  };

  const capture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImg(dataUrl);
    stop();
  };

  const enroll = async () => {
    if (!capturedImg || !token) return;
    setSaving(true);
    setMessage("");
    try {
      const blob = await (await fetch(capturedImg)).blob();
      const aiUrl = process.env.NEXT_PUBLIC_AI_SERVICE_URL || "https://hrms-ai-abv8.onrender.com";
      const form = new FormData();
      form.append("image", blob, "face.jpg");
      await fetch(`/api/employees/${employeeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ photoUrl: capturedImg }),
      });
      const encRes = await fetch(`${aiUrl}/encode-face`, { method: "POST", body: form });
      if (!encRes.ok) { setMessage("AI service unavailable. Deploy the AI service first."); setSaving(false); return; }
      const encData = await encRes.json();
      if (!encData.success) { setMessage("No face detected in image"); setSaving(false); return; }
      const embedding = JSON.stringify(encData.encodings[0]);
      const res = await fetch(`/api/employees/face/${employeeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ faceEmbedding: embedding }),
      });
      if (res.ok) { setEnrolled(true); setMessage("✅ Face enrolled successfully!"); setCapturedImg(null); }
      else { setMessage("Failed to save"); }
    } catch { setMessage("Error during enrollment"); }
    setSaving(false);
  };

  const remove = async () => {
    if (!token || !confirm("Remove face enrollment?")) return;
    await fetch(`/api/employees/face/${employeeId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ faceEmbedding: null }),
    });
    setEnrolled(false);
    setCapturedImg(null);
    setMessage("Face removed");
  };

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [stream]);

  return (
    <div>
      {message && <div className={`alert ${message.includes("✅") ? "alert-success" : "alert-error"}`}>{message}</div>}
      {enrolled && !capturedImg && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="badge badge-success">✅ Face Enrolled</span>
          <button className="btn btn-outline btn-sm" onClick={start}>Re-enroll</button>
          <button className="btn btn-danger btn-sm" onClick={remove}>Remove</button>
        </div>
      )}
      {!enrolled && !active && !capturedImg && (
        <button className="btn btn-primary" onClick={start}>📷 Enroll Face</button>
      )}
      {active && (
        <div className="camera-wrap" style={{ maxWidth: 320 }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8 }} />
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-success" onClick={capture}>📸 Capture</button>
            <button className="btn btn-outline" onClick={stop} style={{ marginLeft: 8 }}>Cancel</button>
          </div>
        </div>
      )}
      {capturedImg && (
        <div>
          <img src={capturedImg} alt="Captured" style={{ width: 200, borderRadius: 8, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={enroll} disabled={saving}>{saving ? "Saving..." : "Save Face"}</button>
            <button className="btn btn-outline" onClick={() => { setCapturedImg(null); start(); }}>Retake</button>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

export default function Page() {
  return <AuthProvider><EditEmployeeContent /></AuthProvider>;
}
