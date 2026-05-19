"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

interface KioskEmployee {
  id: string; firstName: string; lastName: string; employeeCode: string; department: string; encoding: number[];
}

interface FaceLog {
  id: string; employeeId: string; date: string; time: string; type: string; createdAt: string;
  employee?: { firstName: string; lastName: string; employeeCode: string; department: string; photoUrl: string | null };
}

interface MarkResponse {
  success: boolean; type: string; time: string; employeeId: string; employeeName: string; attendance: any; detectionsToday: number;
}

interface QualityInfo {
  blurry: boolean; dark: boolean; good_quality: boolean; face_count: number; score: number;
}

const AI_URL = "https://hrms-ai-abv8.onrender.com";
const MATCH_THRESHOLD = 0.35;
const MARK_COOLDOWN = 30000;
const CAPTURE_INTERVAL = 2500;
const MOTION_THRESHOLD = 8;
const MOTION_FRAME_W = 80;
const MOTION_FRAME_H = 60;

function computeDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function KioskContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [known, setKnown] = useState<KioskEmployee[]>([]);
  const [currentMatch, setCurrentMatch] = useState<{ name: string; code: string; similarity: number; type: string } | null>(null);
  const [sheet, setSheet] = useState<FaceLog[]>([]);
  const [quality, setQuality] = useState<QualityInfo | null>(null);
  const lastMarkedRef = useRef<Record<string, number>>({});
  const prevFrameRef = useRef<ImageData | null>(null);
  const lastCaptureRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const [stats, setStats] = useState({ total: 0, enrolled: 0, todayIn: 0, todayOut: 0 });

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  const fetchSheet = useCallback(async () => {
    if (!token) return;
    const today = new Date().toISOString().split("T")[0];
    try {
      const res = await fetch(`/api/attendance/face-mark?date=${today}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data: FaceLog[] = await res.json();
        setSheet(data);
        setStats((s) => ({ ...s, todayIn: data.filter((l) => l.type === "CHECK_IN").length, todayOut: data.filter((l) => l.type === "CHECK_OUT").length }));
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/employees", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : [])
      .then((d) => {
        const arr = Array.isArray(d) ? d : [];
        const withFace = arr.filter((e: any) => e.faceEmbedding).map((e: any) => ({
          id: e.id, firstName: e.firstName, lastName: e.lastName,
          employeeCode: e.employeeCode, department: e.department,
          encoding: JSON.parse(e.faceEmbedding),
        }));
        setKnown(withFace);
        setStats((s) => ({ ...s, total: arr.length, enrolled: withFace.length }));
      });
    fetchSheet();
  }, [token, fetchSheet]);

  const detectMotion = (): boolean => {
    const video = videoRef.current;
    const motionCanvas = motionCanvasRef.current;
    if (!video || !motionCanvas) return false;
    const ctx = motionCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    motionCanvas.width = MOTION_FRAME_W;
    motionCanvas.height = MOTION_FRAME_H;
    ctx.drawImage(video, 0, 0, MOTION_FRAME_W, MOTION_FRAME_H);
    const current = ctx.getImageData(0, 0, MOTION_FRAME_W, MOTION_FRAME_H);
    if (!prevFrameRef.current) {
      prevFrameRef.current = current;
      return true;
    }
    const prev = prevFrameRef.current.data;
    const curr = current.data;
    let diff = 0;
    const len = prev.length;
    for (let i = 0; i < len; i += 4) {
      diff += Math.abs(prev[i] - curr[i]);
    }
    prevFrameRef.current = current;
    const avgDiff = diff / (len / 4);
    return avgDiff > MOTION_THRESHOLD;
  };

  const captureAndRecognize = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !token || known.length === 0) return;
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
        const encRes = await fetch(`${AI_URL}/encode-face?min_det_score=0.4`, { method: "POST", body: form });
        if (!encRes.ok) { setCurrentMatch(null); return; }
        const encData = await encRes.json();
        setQuality({
          blurry: encData.quality?.blurry ?? false,
          dark: encData.quality?.dark ?? false,
          good_quality: encData.quality?.good_quality ?? false,
          face_count: encData.faces ?? 0,
          score: encData.detection_scores?.[0] ?? 0,
        });
        if (!encData.success || !encData.encodings?.length) { setCurrentMatch(null); return; }
        const target = encData.encodings[0];
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < known.length; i++) {
          const d = computeDistance(known[i].encoding, target);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        const similarity = 1 / (1 + bestDist);
        if (bestIdx === -1 || bestDist > MATCH_THRESHOLD) { setCurrentMatch(null); return; }
        const emp = known[bestIdx];
        const now = Date.now();
        const last = lastMarkedRef.current[emp.id] || 0;
        if (now - last < MARK_COOLDOWN) {
          setCurrentMatch({ name: `${emp.firstName} ${emp.lastName}`, code: emp.employeeCode, similarity, type: "COOLDOWN" });
          return;
        }
        lastMarkedRef.current[emp.id] = now;
        setCurrentMatch({ name: `${emp.firstName} ${emp.lastName}`, code: emp.employeeCode, similarity, type: "MARKING" });
        const markRes = await fetch("/api/attendance/face-mark", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ employeeId: emp.id }),
        });
        if (markRes.ok) {
          const result: MarkResponse = await markRes.json();
          setCurrentMatch({ name: result.employeeName, code: emp.employeeCode, similarity, type: result.type });
          fetchSheet();
        } else {
          setCurrentMatch({ name: `${emp.firstName} ${emp.lastName}`, code: emp.employeeCode, similarity, type: "ERROR" });
        }
      } catch { setCurrentMatch(null); }
    }, "image/jpeg", 0.85);
  };

  useEffect(() => {
    if (!active || known.length === 0) return;
    let running = true;
    const loop = () => {
      if (!running) return;
      animFrameRef.current = requestAnimationFrame(loop);
      try {
        const hasMotion = detectMotion();
        const now = Date.now();
        if (hasMotion && now - lastCaptureRef.current >= CAPTURE_INTERVAL) {
          lastCaptureRef.current = now;
          captureAndRecognize();
        }
      } catch {}
    };
    loop();
    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [active, known.length]);

  useEffect(() => {
    if (!active) return;
    const refresh = setInterval(fetchSheet, 10000);
    return () => clearInterval(refresh);
  }, [active, fetchSheet]);

  const startKiosk = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
      if (videoRef.current) videoRef.current.srcObject = s;
      prevFrameRef.current = null;
      setActive(true);
    } catch { alert("Camera access denied"); }
  };

  const stopKiosk = () => {
    cancelAnimationFrame(animFrameRef.current);
    const video = videoRef.current;
    if (video && video.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
    prevFrameRef.current = null;
    setActive(false);
    setCurrentMatch(null);
    setQuality(null);
  };

  if (authLoading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  const statusColor = currentMatch?.type === "CHECK_IN" ? "var(--success)" : currentMatch?.type === "CHECK_OUT" ? "var(--accent)" : currentMatch?.type === "COOLDOWN" ? "var(--warning)" : "var(--text-muted)";

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Face Recognition Kiosk</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="badge badge-muted">{stats.enrolled}/{stats.total} faces enrolled</span>
            {!active ? (
              <button className="btn btn-success" onClick={startKiosk}>▶ Start Kiosk</button>
            ) : (
              <button className="btn btn-danger" onClick={stopKiosk}>⏹ Stop Kiosk</button>
            )}
          </div>
        </div>

        {known.length === 0 && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            No employees with enrolled faces. Go to Employees → Add Employee to enroll.
          </div>
        )}

        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>
              Live Camera {active ? "🟢" : "⚫"}
              {active && quality && (
                <span style={{ fontSize: 11, marginLeft: 8, fontWeight: 400 }}>
                  {quality.good_quality ? "✅ Good quality" : quality.blurry ? "⚠️ Blurry" : quality.dark ? "⚠️ Too dark" : ""}
                </span>
              )}
            </h3>
            {active ? (
              <div className="camera-wrap">
                <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8 }} />
                <canvas ref={canvasRef} style={{ display: "none" }} />
                <canvas ref={motionCanvasRef} style={{ display: "none" }} />
                {currentMatch && (
                  <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 0,
                    background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
                    padding: 16, borderRadius: "0 0 8px 8px",
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 20, color: statusColor }}>
                      {currentMatch.name}
                    </div>
                    <div style={{ fontSize: 13, color: "#94a3b8", display: "flex", gap: 12 }}>
                      <span>{currentMatch.code}</span>
                      <span style={{ color: statusColor }}>
                        {currentMatch.type === "CHECK_IN" ? "✅ CHECKED IN" :
                         currentMatch.type === "CHECK_OUT" ? "🚪 CHECKED OUT" :
                         currentMatch.type === "COOLDOWN" ? "⏳ Recently marked" :
                         currentMatch.type === "MARKING" ? "⏳ Marking..." : ""}
                      </span>
                      <span>{(currentMatch.similarity * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                )}
                {!currentMatch && (
                  <div style={{
                    position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                    color: "rgba(255,255,255,0.2)", fontSize: 14, textAlign: "center",
                  }}>
                    Scanning for faces...
                    <div style={{ fontSize: 11, marginTop: 4 }}>Motion-activated capture</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="map-placeholder">
                <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
                <div>Camera is off</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Click Start Kiosk to begin</div>
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, margin: 0 }}>Today's Detection Sheet</h3>
              <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
                <span className="badge badge-success">IN: {stats.todayIn}</span>
                <span className="badge badge-accent">OUT: {stats.todayOut}</span>
              </div>
            </div>
            <div style={{ maxHeight: 440, overflowY: "auto", fontSize: 13 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Time</th>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Employee</th>
                    <th style={{ textAlign: "left", padding: "6px 8px" }}>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.map((log) => (
                    <tr key={log.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{log.time}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {log.employee?.firstName} {log.employee?.lastName}
                        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>{log.employee?.employeeCode}</span>
                      </td>
                      <td style={{ padding: "6px 8px" }}>
                        {log.type === "CHECK_IN" ? (
                          <span className="badge badge-success">CHECK IN</span>
                        ) : (
                          <span className="badge badge-accent">CHECK OUT</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {sheet.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                      {active ? "No detections yet today" : "Start kiosk to begin detection"}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>
            Enrolled Employees ({stats.enrolled}/{stats.total})
          </h3>
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: "auto" }}>
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Department</th><th>Face</th></tr></thead>
              <tbody>
                {known.length === 0 && (
                  <tr><td colSpan={4} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No employees enrolled</td></tr>
                )}
                {known.map((e) => (
                  <tr key={e.id}>
                    <td>{e.employeeCode}</td>
                    <td>{e.firstName} {e.lastName}</td>
                    <td>{e.department}</td>
                    <td><span className="badge badge-success">✅ Enrolled</span></td>
                  </tr>
                ))}
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
