"use client";
import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import FaceCapture from "@/components/FaceCapture";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { encodeFace } from "@/lib/face";

function EmployeeForm() {
  const { token } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", mobile: "", department: "",
  });
  const [faceStatus, setFaceStatus] = useState<"idle" | "encoding" | "done" | "error">("idle");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const setField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleCapture = (blob: Blob) => {
    setPhotoBlob(blob);
    setPhotoUrl(URL.createObjectURL(blob));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    try {
      if (!photoBlob) { setError("Wait for auto face capture"); setSaving(false); return; }

      setFaceStatus("encoding");
      const encData = await encodeFace(photoBlob);
      if (!encData.success || !encData.encodings?.length) {
        throw new Error(encData.message || "No face detected. Look directly at camera in good lighting.");
      }
      const embedding = JSON.stringify(encData.encodings[0]);

      const today = new Date().toISOString().split("T")[0];
      const payload = {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        mobile: form.mobile || `test-${Date.now()}`,
        department: form.department || "General",
        designation: form.department || "Staff",
        joinDate: today,
        shiftType: "GENERAL",
      };

      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to save");
      }

      const emp = await res.json();

      // Save face encoding
      const faceRes = await fetch(`/api/employees/face/${emp.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ faceEmbedding: embedding }),
      });
      if (!faceRes.ok) throw new Error("Face save failed");

      setFaceStatus("done");
      setTimeout(() => router.push("/employees"), 1500);
    } catch (err: any) {
      setError(err.message || "Error");
      setFaceStatus("error");
    }
    setSaving(false);
  };

  const fields = [
    { label: "First Name", key: "firstName", required: true },
    { label: "Last Name", key: "lastName", required: true },
    { label: "Email", key: "email", type: "email", required: true },
    { label: "Mobile", key: "mobile", type: "tel" },
    { label: "Department", key: "department" },
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
        {faceStatus === "done" && <div className="alert alert-success">✅ Employee created with face! Redirecting...</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16, alignItems: "start" }}>
          <div className="card">
            <form onSubmit={handleSubmit}>
              <div className="grid-3">
                {fields.map((f) => (
                  <div className="form-group" key={f.key}>
                    <label>{f.label}</label>
                    <input
                      type={f.type || "text"}
                      className="form-control"
                      placeholder={f.label}
                      value={(form as any)[f.key]}
                      onChange={(e) => setField(f.key, e.target.value)}
                      required={f.required}
                    />
                  </div>
                ))}
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving || faceStatus === "encoding" || !photoBlob} style={{ marginTop: 16 }}>
                {saving || faceStatus === "encoding" ? "Processing..." : "Create Employee"}
              </button>
            </form>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Face Capture</h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Camera auto-detects your face — no button needed</p>
            {photoUrl ? (
              <div>
                <img src={photoUrl} alt="Captured" style={{ width: "100%", borderRadius: 8 }} />
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <span style={{ color: "var(--success)", fontSize: 13 }}>✅ Auto-captured!</span>
                  {faceStatus !== "done" && (
                    <button className="btn btn-sm" onClick={() => { setPhotoBlob(null); setPhotoUrl(null); }}>Retake</button>
                  )}
                </div>
                {faceStatus === "encoding" && <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>⏳ AI encoding...</p>}
              </div>
            ) : (
              <FaceCapture onCapture={handleCapture} width={320} height={240} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Page() {
  return <AuthProvider><EmployeeForm /></AuthProvider>;
}
