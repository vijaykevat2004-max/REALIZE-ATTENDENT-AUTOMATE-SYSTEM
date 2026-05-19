"use client";
import { useEffect, useState, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

interface FaceLog {
  id: string;
  employeeId: string;
  date: string;
  time: string;
  type: string;
  employee?: { firstName: string; lastName: string; employeeCode: string; department: string };
}

function AttendanceContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<any[]>([]);
  const [faceLogs, setFaceLogs] = useState<FaceLog[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [employeeId, setEmployeeId] = useState("");
  const [status, setStatus] = useState("PRESENT");
  const [inTime, setInTime] = useState("");
  const [outTime, setOutTime] = useState("");
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [tab, setTab] = useState<"attendance" | "face">("attendance");

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (token) {
      fetch("/api/employees", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : []).then(setEmployees);
      fetch(`/api/attendance?date=${date}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : []).then(setLogs);
      fetch(`/api/attendance/face-mark?date=${date}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : []).then(setFaceLogs);
    }
  }, [token, date]);

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
      setShowCamera(true);
    } catch { alert("Camera access denied"); }
  };

  const stopCamera = () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    setStream(null);
    setShowCamera(false);
  };

  const capturePhoto = () => {
    stopCamera();
    setStatus("PRESENT");
  };

  const markAttendance = async () => {
    if (!employeeId) return alert("Select employee");
    const body: any = { employeeId, date, status };
    if (inTime) body.inTime = inTime;
    if (outTime) body.outTime = outTime;
    const res = await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      alert("Attendance marked!");
      const r = await fetch(`/api/attendance?date=${date}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setLogs(await r.json());
    } else {
      const d = await res.json();
      alert(d.error || "Failed");
    }
  };

  if (authLoading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Attendance</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" className="form-control" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 180 }} />
          </div>
        </div>
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Mark Attendance</h3>
            <div className="form-group">
              <label>Employee</label>
              <select className="form-control" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">Select...</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Status</label>
              <select className="form-control" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="PRESENT">Present</option>
                <option value="LATE">Late</option>
                <option value="HALF_DAY">Half Day</option>
                <option value="ABSENT">Absent</option>
              </select>
            </div>
            <div className="grid-2">
              <div className="form-group">
                <label>In Time</label>
                <input type="time" className="form-control" value={inTime} onChange={(e) => setInTime(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Out Time</label>
                <input type="time" className="form-control" value={outTime} onChange={(e) => setOutTime(e.target.value)} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={markAttendance}>Mark Attendance</button>
              <button className="btn btn-outline" onClick={startCamera}>📷 Camera Check-in</button>
            </div>
            {showCamera && (
              <div className="camera-wrap" style={{ marginTop: 12 }}>
                <video ref={videoRef} autoPlay playsInline />
                <div className="camera-overlay">
                  <button className="btn btn-success" onClick={capturePhoto}>📸 Capture</button>
                </div>
              </div>
            )}
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Quick Stats</h3>
            <div className="grid-2">
              <div className="stat-card" style={{ padding: 0 }}>
                <div className="label">Present</div>
                <div className="value" style={{ fontSize: 20 }}>{logs.filter((l) => l.status === "PRESENT").length}</div>
              </div>
              <div className="stat-card" style={{ padding: 0 }}>
                <div className="label">Late</div>
                <div className="value" style={{ fontSize: 20, color: "var(--warning)" }}>{logs.filter((l) => l.status === "LATE").length}</div>
              </div>
              <div className="stat-card" style={{ padding: 0 }}>
                <div className="label">Face IN</div>
                <div className="value" style={{ fontSize: 20, color: "var(--accent)" }}>{faceLogs.filter((l) => l.type === "CHECK_IN").length}</div>
              </div>
              <div className="stat-card" style={{ padding: 0 }}>
                <div className="label">Face OUT</div>
                <div className="value" style={{ fontSize: 20, color: "var(--success)" }}>{faceLogs.filter((l) => l.type === "CHECK_OUT").length}</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button className={`btn ${tab === "attendance" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("attendance")}>Attendance Logs</button>
          <button className={`btn ${tab === "face" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("face")}>Face Detection Sheet ({faceLogs.length})</button>
        </div>

        {tab === "attendance" && (
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Attendance Logs - {date}</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Employee</th><th>In</th><th>Out</th><th>Status</th><th>Late</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {logs.map((l, i) => (
                    <tr key={i}>
                      <td>{l.employee?.firstName} {l.employee?.lastName}</td>
                      <td>{l.inTime || "-"}</td>
                      <td>{l.outTime || "-"}</td>
                      <td><span className={`badge badge-${l.status === "PRESENT" ? "success" : l.status === "LATE" ? "warning" : "danger"}`}>{l.status}</span></td>
                      <td>{l.lateMinutes ? `${l.lateMinutes}m` : "-"}</td>
                      <td>{l.source}</td>
                    </tr>
                  ))}
                  {logs.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: 40 }}>No records</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "face" && (
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>
              Face Detection Sheet — {date}
              <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 8, color: "var(--text-muted)" }}>
                Every face detection creates a row. First detection = IN, next = OUT, alternates.
              </span>
            </h3>
            <div className="table-wrap" style={{ maxHeight: 500, overflowY: "auto" }}>
              <table>
                <thead>
                  <tr><th>#</th><th>Time</th><th>Employee</th><th>Code</th><th>Type</th></tr>
                </thead>
                <tbody>
                  {faceLogs.map((l, i) => (
                    <tr key={l.id}>
                      <td>{i + 1}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>{l.time}</td>
                      <td>{l.employee?.firstName} {l.employee?.lastName}</td>
                      <td style={{ color: "var(--text-muted)", fontSize: 13 }}>{l.employee?.employeeCode}</td>
                      <td>
                        {l.type === "CHECK_IN" ? (
                          <span className="badge badge-success">✅ CHECK IN</span>
                        ) : (
                          <span className="badge badge-accent">🚪 CHECK OUT</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {faceLogs.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                      No face detections for this date. Use the Kiosk page to scan faces.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function AttendancePage() {
  return <AuthProvider><AttendanceContent /></AuthProvider>;
}
