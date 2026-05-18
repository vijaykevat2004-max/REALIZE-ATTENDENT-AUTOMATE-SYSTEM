"use client";
import { useEffect, useState, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  department: string;
  designation: string;
  faceEmbedding: string | null;
}

function KioskContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [recognized, setRecognized] = useState<Employee | null>(null);
  const [lastMarked, setLastMarked] = useState<Record<string, number>>({});
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/employees", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setEmployees(Array.isArray(d) ? d.filter((e: any) => e.faceEmbedding) : []));
  }, [token]);

  const startKiosk = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
      setActive(true);
      addLog("Camera started");
    } catch { alert("Camera access denied"); }
  };

  const stopKiosk = () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setActive(false);
    setRecognized(null);
    addLog("Camera stopped");
  };

  const addLog = (msg: string) => setLog((prev) => [new Date().toLocaleTimeString() + " - " + msg, ...prev].slice(0, 50));

  const captureAndRecognize = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !token) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const form = new FormData();
      form.append("image", blob, "frame.jpg");

      try {
        const aiUrl = process.env.NEXT_PUBLIC_AI_SERVICE_URL || "https://hrms-ai-service.onrender.com";
        const encRes = await fetch(`${aiUrl}/encode-face`, { method: "POST", body: form });
        if (!encRes.ok) return;
        const encData = await encRes.json();
        if (!encData.success || !encData.encodings?.length) return;

        const targetEncoding = encData.encodings[0];
        const known = employees
          .filter((e) => e.faceEmbedding)
          .map((e) => ({ id: e.id, encoding: JSON.parse(e.faceEmbedding!) }));

        let bestMatch: Employee | null = null;
        let bestConfidence = 0;

        for (const emp of known) {
          const matchRes = await fetch(`${aiUrl}/match-face`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ known_embeddings: [emp.encoding], target_embedding: targetEncoding, threshold: 0.5 }),
          });
          if (!matchRes.ok) continue;
          const match = await matchRes.json();
          if (match.matched && match.confidence > bestConfidence) {
            bestConfidence = match.confidence;
            bestMatch = employees.find((e) => e.id === emp.id) || null;
          }
        }

        if (bestMatch) {
          setRecognized(bestMatch);
          const now = Date.now();
          const last = lastMarked[bestMatch.id] || 0;
          if (now - last > 60000) {
            setLastMarked((p) => ({ ...p, [bestMatch.id]: now }));
            const date = new Date().toISOString().split("T")[0];
            const time = new Date().toTimeString().split(" ")[0].slice(0, 5);
            const markRes = await fetch("/api/attendance", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({ employeeId: bestMatch.id, date, status: "PRESENT", inTime: time, source: "FACE" }),
            });
            if (markRes.ok) addLog(`✅ ${bestMatch.firstName} ${bestMatch.lastName} - Attendance marked at ${time}`);
            else addLog(`❌ ${bestMatch.firstName} - Mark failed`);
          } else {
            addLog(`👁 ${bestMatch.firstName} ${bestMatch.lastName} - Already marked (${Math.round((now - last) / 1000)}s ago)`);
          }
        } else {
          setRecognized(null);
        }
      } catch { /* AI service unavailable */ }
    }, "image/jpeg", 0.8);
  };

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(captureAndRecognize, 3000);
    return () => clearInterval(interval);
  }, [active, employees, token, lastMarked]);

  useEffect(() => {
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [stream]);

  const hasFaces = employees.some((e) => e.faceEmbedding);

  if (authLoading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Face Recognition Kiosk</h1>
          <div style={{ display: "flex", gap: 8 }}>
            {!active ? (
              <button className="btn btn-success" onClick={startKiosk}>▶ Start Kiosk</button>
            ) : (
              <button className="btn btn-danger" onClick={stopKiosk}>⏹ Stop Kiosk</button>
            )}
          </div>
        </div>

        {!hasFaces && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            No employees have enrolled faces. Go to Employees → Edit to enroll faces first.
          </div>
        )}

        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Live Camera</h3>
            {active ? (
              <div className="camera-wrap">
                <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8 }} />
                <canvas ref={canvasRef} style={{ display: "none" }} />
                {recognized && (
                  <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 0,
                    background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
                    padding: 16, borderRadius: "0 0 8px 8px",
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 18 }}>{recognized.firstName} {recognized.lastName}</div>
                    <div style={{ fontSize: 13, color: "#94a3b8" }}>{recognized.employeeCode} · {recognized.department}</div>
                  </div>
                )}
                {!recognized && active && (
                  <div style={{
                    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                    color: "rgba(255,255,255,0.3)", fontSize: 14,
                  }}>
                    Waiting for face...
                  </div>
                )}
              </div>
            ) : (
              <div className="map-placeholder">Camera is off</div>
            )}
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Activity Log</h3>
            <div style={{ maxHeight: 400, overflowY: "auto", fontSize: 13 }}>
              {log.map((entry, i) => (
                <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid var(--border)", color: entry.startsWith("✅") ? "var(--success)" : entry.startsWith("❌") ? "var(--danger)" : entry.startsWith("👁") ? "var(--accent)" : "var(--text-muted)" }}>
                  {entry}
                </div>
              ))}
              {log.length === 0 && <p style={{ color: "var(--text-muted)" }}>No activity yet</p>}
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>
            Enrolled Employees ({employees.filter((e) => e.faceEmbedding).length}/{employees.length})
          </h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Department</th><th>Face Enrolled</th></tr></thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td>{e.employeeCode}</td>
                    <td>{e.firstName} {e.lastName}</td>
                    <td>{e.department}</td>
                    <td>
                      {e.faceEmbedding ? (
                        <span className="badge badge-success">✅ Enrolled</span>
                      ) : (
                        <span className="badge badge-muted">❌ Not enrolled</span>
                      )}
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No employees</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function KioskPage() {
  return <AuthProvider><KioskContent /></AuthProvider>;
}
