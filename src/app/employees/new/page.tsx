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
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", mobile: "", department: "" });
  const [blob, setBlob] = useState<Blob | null>(null);
  const [faceStatus, setFaceStatus] = useState<"idle" | "encoding" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fields = [
    { label: "First Name", key: "firstName", required: true },
    { label: "Last Name", key: "lastName", required: true },
    { label: "Email", key: "email", type: "email", required: true },
    { label: "Mobile", key: "mobile", type: "tel" },
    { label: "Department", key: "department" },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (!blob) { setError("Capture a photo first"); setSaving(false); return; }
      setFaceStatus("encoding");
      const enc = await encodeFace(blob);
      if (!enc.success || !enc.encodings?.length) throw new Error(enc.message || "No face detected");
      if (enc.quality && !enc.quality.good_quality) {
        const issues = enc.quality.issues.join(", ");
        throw new Error(`Face quality too low: ${issues}. Look directly at camera in good lighting.`);
      }
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
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Face Photo</h3>
            <FaceCapture onCapture={setBlob} />
            {faceStatus === "encoding" && <p style={{ fontSize: 12, marginTop: 4 }}>⏳ AI encoding face...</p>}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Page() {
  return <AuthProvider><EmployeeForm /></AuthProvider>;
}
