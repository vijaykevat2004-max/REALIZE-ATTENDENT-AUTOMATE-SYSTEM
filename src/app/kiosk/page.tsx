"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import { encodeAllFaces, getLoadingStatus } from "@/lib/face";

interface KioskEmployee {
  id: string; firstName: string; lastName: string; employeeCode: string; department: string; encoding: number[];
}

interface FaceLog {
  id: string; employeeId: string; date: string; time: string; type: string; createdAt: string;
  employee?: { firstName: string; lastName: string; employeeCode: string; department: string; photoUrl: string | null };
}

interface DetectionInfo {
  time: string;
  type: "check" | "match" | "mark" | "fail" | "info";
  empName?: string;
  empCode?: string;
  empDept?: string;
  distance?: number;
  confidence?: number;
  faceCount?: number;
  matchedIndex?: number;
  knownCount?: number;
  message: string;
}

const MATCH_THRESHOLD = 0.6;
const MARK_COOLDOWN = 15000;
const CAPTURE_INTERVAL = 2000;
const MOTION_THRESHOLD = 4;
const MOTION_FRAME_W = 80;
const MOTION_FRAME_H = 60;

function computeDistance(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return Infinity;
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US"; u.rate = 0.9; u.pitch = 1.1;
  window.speechSynthesis.speak(u);
}

function KioskContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motionCanvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [known, setKnown] = useState<KioskEmployee[]>([]);
  const [detections, setDetections] = useState<DetectionInfo[]>([]);
  const [sheet, setSheet] = useState<FaceLog[]>([]);
  const [announceEnabled, setAnnounceEnabled] = useState(true);
  const lastMarkedRef = useRef<Record<string, number>>({});
  const prevFrameRef = useRef<ImageData | null>(null);
  const lastCaptureRef = useRef(0);
  const animFrameRef = useRef<number>(0);
  const capturingRef = useRef(false);
  const capturingCount = useRef(0);
  const [stats, setStats] = useState({ total: 0, enrolled: 0, todayIn: 0, todayOut: 0, activeNow: 0 });
  const [camStatus, setCamStatus] = useState("initializing");
  const [modelLoading, setModelLoading] = useState("");
  const [modelReady, setModelReady] = useState(false);
  const [debugOverlay, setDebugOverlay] = useState({ status: "initializing", faces: 0, dims: 0, error: "", lastOk: "" });

  const [debugInfo, setDebugInfo] = useState({ models: "", employees: "", lastCapture: "", lastResult: "" });

  const addDet = (d: DetectionInfo) => {
    setDetections((prev) => [d, ...prev].slice(0, 100));
  };

  const testCapture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !token) { addDet({ time: new Date().toLocaleTimeString(), type: "fail", message: "Kiosk not ready" }); return; }
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const blob = await (await fetch(dataUrl)).blob();
    const t0 = performance.now();
    addDet({ time: new Date().toLocaleTimeString(), type: "check", message: `Encoding ${(blob.size / 1024).toFixed(1)}KB...` });
    const encData = await encodeAllFaces(blob);
    const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
    const dim = encData.encodings?.[0]?.length || 0;
    const count = encData.encodings?.length || 0;
    const scores = encData.scores?.map(s => Math.round(s * 100)).join(", ") || "none";
    addDet({ time: new Date().toLocaleTimeString(), type: count > 0 ? "match" : "fail", faceCount: count,
      message: `Test: ${count} face(s), dim=${dim}, scores=[${scores}], ${elapsed}s — ${encData.message || "ok"}` });
    setDebugInfo(d => ({ ...d, lastResult: `${count} faces dim=${dim} in ${elapsed}s` }));
  };

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  const fetchSheet = useCallback(async () => {
    if (!token) return;
    const today = new Date().toISOString().split("T")[0];
    try {
      const [logsRes, activeRes] = await Promise.all([
        fetch(`/api/attendance/face-mark?date=${today}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/attendance/face-mark?date=${today}&mode=active`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (logsRes.ok) {
        const data: FaceLog[] = await logsRes.json();
        setSheet(data);
        setStats((s) => ({ ...s, todayIn: data.filter((l) => l.type === "CHECK_IN").length, todayOut: data.filter((l) => l.type === "CHECK_OUT").length }));
      }
      if (activeRes.ok) {
        const active = await activeRes.json();
        setStats((s) => ({ ...s, activeNow: active.length }));
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
        addDet({ time: new Date().toLocaleTimeString(), type: "info", message: `Loaded ${withFace.length}/${arr.length} employees with faces` });
      })
      .catch(() => addDet({ time: new Date().toLocaleTimeString(), type: "info", message: "Failed to load employees" }));
    fetchSheet();
  }, [token, fetchSheet]);

  const autoStart = useCallback(async () => {
    try {
      setCamStatus("requesting camera...");
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } });
      if (videoRef.current) videoRef.current.srcObject = s;
      setCamStatus("camera ready");
      prevFrameRef.current = null;
      setActive(true);
      setDetections([]);
      addDet({ time: new Date().toLocaleTimeString(), type: "info", message: "Kiosk started automatically" });
      // Monitor model loading
      const checkModels = setInterval(() => {
        const status = getLoadingStatus();
        if (status) { setModelLoading(status); addDet({ time: new Date().toLocaleTimeString(), type: "info", message: status }); }
        if (!status) {
          setModelLoading("");
          setModelReady(true);
          clearInterval(checkModels);
          addDet({ time: new Date().toLocaleTimeString(), type: "info", message: "Face recognition model ready" });
        }
      }, 500);
    } catch (e: any) {
      setCamStatus("camera blocked");
      addDet({ time: new Date().toLocaleTimeString(), type: "info", message: "Camera access denied. Click Start Kiosk manually." });
    }
  }, []);

  useEffect(() => {
    if (token && !authLoading && known.length > 0 && !active) {
      autoStart();
    }
  }, [token, authLoading, known.length, active, autoStart]);

  const detectMotion = (): boolean => {
    const video = videoRef.current;
    const mc = motionCanvasRef.current;
    if (!video || !mc) return false;
    const ctx = mc.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    mc.width = MOTION_FRAME_W; mc.height = MOTION_FRAME_H;
    ctx.drawImage(video, 0, 0, MOTION_FRAME_W, MOTION_FRAME_H);
    const current = ctx.getImageData(0, 0, MOTION_FRAME_W, MOTION_FRAME_H);
    if (!prevFrameRef.current) { prevFrameRef.current = current; return true; }
    const prev = prevFrameRef.current.data;
    const curr = current.data;
    let diff = 0;
    for (let i = 0; i < prev.length; i += 4) diff += Math.abs(prev[i] - curr[i]);
    prevFrameRef.current = current;
    return diff / (prev.length / 4) > MOTION_THRESHOLD;
  };

  const captureAndRecognize = async (force = false) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !token || known.length === 0) return;
    if (capturingRef.current) { console.log("⏳ Already capturing, skipping"); return; }
    capturingRef.current = true;
    const safetyTimer = setTimeout(() => { capturingRef.current = false; console.log("⚠️ Safety reset capturingRef"); }, 10000);
    let checkTime = "";
    let frameDataUrl = "";
    setDebugOverlay(d => ({ ...d, status: "capturing..." }));
    console.log(`📸 captureAndRecognize called (force=${force}), known=${known.length}`);
    try {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      frameDataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const blob = await (await fetch(frameDataUrl)).blob();
      checkTime = new Date().toLocaleTimeString();
      setDebugOverlay(d => ({ ...d, lastOk: `frame ${(blob.size / 1024).toFixed(0)}KB @ ${checkTime}` }));
      console.log(`🔍 Encoding faces locally (${(blob.size / 1024).toFixed(1)}KB)...`);
      addDet({ time: checkTime, type: "check", message: "Detecting faces..." });
      const encData = await encodeAllFaces(blob);
      const faceCount = encData.encodings?.length || 0;
      const dims = encData.encodings?.[0]?.length || 0;
      const maxScore = encData.quality?.max_detection_score ? Math.round(encData.quality.max_detection_score * 100) : 0;
      setDebugOverlay(d => ({ ...d, status: "detecting", faces: faceCount, dims, error: encData.success ? "" : (encData.message || "") }));
      addDet({ time: checkTime, type: "check", faceCount, message: `Detected ${faceCount} face(s) (confidence: ${maxScore}%, dim: ${dims})` });
      console.log(`🤖 face-api: faces=${faceCount}, dim=${dims}, success=${encData.success}, message=${encData.message || "ok"}`);
      if (!encData.success || !encData.encodings?.length) {
        addDet({ time: checkTime, type: "fail", faceCount: 0, message: encData.message || "No face detected" });
        setDebugOverlay(d => ({ ...d, status: "no face", error: encData.message || "No face" }));
        return;
      }
      const now = Date.now();
      for (let fi = 0; fi < encData.encodings.length; fi++) {
        const target = encData.encodings[fi];
        let bestIdx = -1, bestDist = Infinity;
        for (let i = 0; i < known.length; i++) {
          const d = computeDistance(known[i].encoding, target);
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        if (bestIdx === -1) {
          addDet({ time: checkTime, type: "fail", message: "No enrolled faces to match against" });
          continue;
        }
        const emp = known[bestIdx];
        if (bestDist === Infinity) {
          const msg = `Dimension mismatch: face-api ${target.length}-dim vs enrolled ${emp.encoding.length}-dim. Re-enroll face.`;
          addDet({ time: checkTime, type: "fail", message: msg });
          setDebugOverlay(d => ({ ...d, status: "dim mismatch", error: msg }));
          continue;
        }
        const dist = Math.round(bestDist * 1000) / 1000;
        const conf = Math.round((1 / (1 + bestDist)) * 100);
        if (bestDist > MATCH_THRESHOLD) {
          addDet({ time: checkTime, type: "fail", empName: `${emp.firstName} ${emp.lastName}`, distance: dist, confidence: conf, message: `Match ${emp.firstName} ${emp.lastName} — distance ${dist} > threshold ${MATCH_THRESHOLD}` });
          setDebugOverlay(d => ({ ...d, status: "no match", error: `dist ${dist} > ${MATCH_THRESHOLD}` }));
          continue;
        }
        const last = lastMarkedRef.current[emp.id] || 0;
        if (now - last < MARK_COOLDOWN) {
          addDet({ time: checkTime, type: "info", faceCount, empName: `${emp.firstName} ${emp.lastName}`, distance: dist, confidence: conf, message: `⏳ ${emp.firstName} ${emp.lastName} — cooldown (${Math.ceil((MARK_COOLDOWN - (now - last)) / 1000)}s)` });
          continue;
        }
        lastMarkedRef.current[emp.id] = now;
        setDebugOverlay(d => ({ ...d, status: `matched ${emp.firstName} ${emp.lastName}`, error: "" }));
        addDet({ time: checkTime, type: "match", empName: `${emp.firstName} ${emp.lastName}`, distance: dist, confidence: conf, message: `✅ ${emp.firstName} ${emp.lastName} (dist: ${dist}, conf: ${conf}%)` });
        const markRes = await fetch("/api/attendance/face-mark", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ employeeId: emp.id, photoUrl: frameDataUrl }),
        });
        if (markRes.ok) {
          const result = await markRes.json();
          addDet({ time: checkTime, type: "mark", empName: result.employeeName, message: `✅ ${result.employeeName} ${result.type === "CHECK_IN" ? "CHECKED IN" : "CHECKED OUT"} at ${result.time}` });
          if (announceEnabled) speak(`${result.type === "CHECK_IN" ? "Good morning" : "Goodbye"}, ${emp.firstName}`);
          fetchSheet();
        } else {
          addDet({ time: checkTime, type: "fail", empName: `${emp.firstName} ${emp.lastName}`, message: `❌ Mark failed: ${(await markRes.json().catch(() => ({}))).error || markRes.status}` });
        }
      }
    } catch (e: any) {
      const msg = e.message || "unknown error";
      console.log(`❌ capture error: ${msg}`);
      addDet({ time: checkTime, type: "fail", message: `Error: ${msg}` });
      setDebugOverlay(d => ({ ...d, status: "error", error: msg }));
    } finally {
      clearTimeout(safetyTimer);
      capturingRef.current = false;
      console.log(`✅ captureAndRecognize done (${capturingCount.current++})`);
    }
  };

  useEffect(() => {
    if (!active || known.length === 0) return;
    let running = true;
    let frameCount = 0;
    const loop = () => {
      if (!running) return;
      animFrameRef.current = requestAnimationFrame(loop);
      try {
        frameCount++;
        const motion = detectMotion();
        const elapsed = Date.now() - lastCaptureRef.current;
        const shouldCapture = motion || elapsed >= 4000;
        if (shouldCapture && elapsed >= CAPTURE_INTERVAL) {
          lastCaptureRef.current = Date.now();
          captureAndRecognize();
        }
      } catch (e) { console.log("loop error:", e); }
    };
    loop();
    return () => { running = false; cancelAnimationFrame(animFrameRef.current); };
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
      setCamStatus("camera ready");
      prevFrameRef.current = null;
      setActive(true);
      setDetections([]);
      addDet({ time: new Date().toLocaleTimeString(), type: "info", message: "Kiosk started" });
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
    setCamStatus("stopped");
  };

  if (authLoading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Face Recognition Kiosk</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="badge badge-success">👤 {stats.activeNow} in office</span>
            <span className="badge badge-muted">{stats.enrolled}/{stats.total} enrolled</span>
            <span className="badge badge-muted" style={{ fontSize: 11 }}>{camStatus}</span>
            <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={announceEnabled} onChange={(e) => setAnnounceEnabled(e.target.checked)} />
              Voice
            </label>
            {!active ? (
              <button className="btn btn-success" onClick={startKiosk}>▶ Start Kiosk</button>
            ) : (
              <>
                <button className="btn btn-primary" onClick={() => captureAndRecognize(true)}>📸 Capture Now</button>
                <button className="btn btn-outline" onClick={testCapture} title="Single-frame diagnostic capture">🔍 Test</button>
                <button className="btn btn-danger" onClick={stopKiosk}>⏹ Stop</button>
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, fontSize: 12, marginBottom: 8, color: "var(--text-muted)", flexWrap: "wrap" }}>
          <span>📦 Models: {modelReady ? "✅ ready" : modelLoading || "loading..."}</span>
          <span>👥 Known: {known.length} employees</span>
          <span>📸 Captures: {capturingCount.current}</span>
          <span>🔬 Last: {debugInfo.lastResult || "—"}</span>
          <button className="btn btn-outline btn-sm" onClick={() => {
            fetch("/api/employees", { headers: { Authorization: `Bearer ${token}` } })
              .then(r => r.ok ? r.json() : [])
              .then(d => {
                const arr = Array.isArray(d) ? d : [];
                const withFace = arr.filter((e: any) => e.faceEmbedding).map((e: any) => ({
                  id: e.id, firstName: e.firstName, lastName: e.lastName,
                  employeeCode: e.employeeCode, department: e.department,
                  encoding: JSON.parse(e.faceEmbedding),
                }));
                setKnown(withFace);
                setDebugInfo(di => ({ ...di, employees: `${withFace.length}/${arr.length}` }));
                addDet({ time: new Date().toLocaleTimeString(), type: "info", message: `Reloaded ${withFace.length}/${arr.length} employees` });
              });
          }}>🔄 Reload</button>
        </div>

        {known.length === 0 && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            No employees with enrolled faces. Go to Employees → Add Employee to enroll.
          </div>
        )}

        {modelLoading && (
          <div className="alert alert-info" style={{ marginBottom: 12, fontSize: 13 }}>
            ⏳ {modelLoading}
          </div>
        )}
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Live Camera {active ? "🟢" : "⚫"}</h3>
            {active ? (
              <div className="camera-wrap" style={{ position: "relative" }}>
                <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 8 }} />
                <canvas ref={canvasRef} style={{ display: "none" }} />
                <canvas ref={motionCanvasRef} style={{ display: "none" }} />
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0,
                  background: "rgba(0,0,0,0.7)", color: "#fff",
                  padding: "4px 8px", fontSize: 11, fontFamily: "monospace",
                  display: "flex", gap: 12, borderRadius: "8px 8px 0 0",
                }}>
                  <span style={{ color: debugOverlay.error ? "#ef4444" : "#22c55e" }}>
                    {debugOverlay.status}
                  </span>
                  <span>faces: {debugOverlay.faces}</span>
                  <span>dim: {debugOverlay.dims}</span>
                  {debugOverlay.error && <span style={{ color: "#ef4444", flex: 1, textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{debugOverlay.error}</span>}
                </div>
                {detections.length > 0 && detections[0].type === "check" && (
                  <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.6)", color: "#94a3b8", padding: "4px 8px", borderRadius: 4, fontSize: 11 }}>
                    Scanning...
                  </div>
                )}
                {detections.length > 0 && (detections[0].type === "match" || detections[0].type === "mark") && (
                  <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 0,
                    background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
                    padding: 16, borderRadius: "0 0 8px 8px",
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 18, color: detections[0].type === "mark" ? "var(--success)" : "var(--accent)" }}>
                      {detections[0].empName}
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8", display: "flex", gap: 8 }}>
                      <span>{detections[0].empCode}</span>
                      <span>{detections[0].empDept}</span>
                      <span>{detections[0].confidence}%</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="map-placeholder">
                <div style={{ fontSize: 48, marginBottom: 8 }}>📷</div>
                <div>Camera off</div>
              </div>
            )}
          </div>

          <div className="card" style={{ display: "flex", flexDirection: "column", maxHeight: 500 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexShrink: 0 }}>
              <h3 style={{ fontSize: 15, margin: 0 }}>Today's Log</h3>
              <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
                <span className="badge badge-success">IN: {stats.todayIn}</span>
                <span className="badge badge-accent">OUT: {stats.todayOut}</span>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: "auto", fontSize: 13 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--border)", position: "sticky", top: 0, background: "var(--card-bg)" }}>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Time</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Employee</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {[...sheet].reverse().slice(0, 20).map((log) => (
                    <tr key={log.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{log.time}</td>
                      <td style={{ padding: "4px 8px" }}>
                        {log.employee?.firstName} {log.employee?.lastName}
                        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>{log.employee?.employeeCode}</span>
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <span className={`badge ${log.type === "CHECK_IN" ? "badge-success" : "badge-accent"}`}>
                          {log.type === "CHECK_IN" ? "IN" : "OUT"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {sheet.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: "center", padding: 30, color: "var(--text-muted)" }}>
                      {active ? "Waiting..." : "Start kiosk"}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h3 style={{ fontSize: 15, margin: 0 }}>Detection Log</h3>
            <button className="btn btn-outline btn-sm" onClick={() => setDetections([])}>Clear</button>
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto", fontSize: 12, fontFamily: "monospace" }}>
            {detections.length === 0 ? (
              <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)" }}>
                {active ? "Detection events appear here..." : "Start kiosk"}
              </div>
            ) : (
              detections.map((d, i) => (
                <div key={i} style={{
                  padding: "4px 8px", borderBottom: "1px solid var(--border)",
                  color: d.type === "fail" ? "var(--danger)" : d.type === "match" || d.type === "mark" ? "var(--success)" : d.type === "info" ? "var(--text-muted)" : "inherit",
                }}>
                  <span style={{ color: "var(--text-muted)", marginRight: 8 }}>{d.time}</span>
                  {d.faceCount !== undefined && <span style={{ color: "var(--text-muted)", marginRight: 8 }}>👤{d.faceCount}</span>}
                  {d.confidence !== undefined && <span style={{ marginRight: 8 }}>{d.confidence}%</span>}
                  {d.distance !== undefined && <span style={{ marginRight: 8, color: "var(--text-muted)" }}>d:{d.distance}</span>}
                  {d.empName && <span style={{ fontWeight: 600, marginRight: 8 }}>{d.empName}</span>}
                  {d.empCode && <span style={{ color: "var(--text-muted)", marginRight: 8 }}>{d.empCode}</span>}
                  {d.empDept && <span style={{ color: "var(--text-muted)", marginRight: 8 }}>{d.empDept}</span>}
                  {d.knownCount !== undefined && <span style={{ color: "var(--text-muted)", marginRight: 8 }}>known:{d.knownCount}</span>}
                  <span>{d.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function KioskPage() {
  return <AuthProvider><KioskContent /></AuthProvider>;
}
