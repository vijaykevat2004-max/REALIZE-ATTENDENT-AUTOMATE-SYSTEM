"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

function ShiftsContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [shifts, setShifts] = useState<any[]>([]);
  const [form, setForm] = useState({ name: "", type: "GENERAL", startTime: "09:00", endTime: "18:00", breakMinutes: 60, lateThreshold: 15, earlyExitThreshold: 30 });

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (token) {
      fetch("/api/shifts", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : []).then((d) => setShifts(Array.isArray(d) ? d : []));
    }
  }, [token]);

  const addShift = async () => {
    if (!form.name) return;
    const res = await fetch("/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ name: "", type: "GENERAL", startTime: "09:00", endTime: "18:00", breakMinutes: 60, lateThreshold: 15, earlyExitThreshold: 30 });
      fetch("/api/shifts", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : []).then((d) => setShifts(Array.isArray(d) ? d : []));
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
        <div className="page-header"><h1>Shifts</h1></div>
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Create Shift</h3>
            <div className="form-group"><label>Shift Name</label><input className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="form-group"><label>Type</label>
              <select className="form-control" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="GENERAL">General</option><option value="MORNING">Morning</option><option value="NIGHT">Night</option>
              </select>
            </div>
            <div className="grid-2">
              <div className="form-group"><label>Start Time</label><input type="time" className="form-control" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
              <div className="form-group"><label>End Time</label><input type="time" className="form-control" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></div>
            </div>
            <div className="form-group"><label>Break (minutes)</label><input type="number" className="form-control" value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: parseInt(e.target.value) || 0 })} /></div>
            <div className="grid-2">
              <div className="form-group"><label>Late Threshold (min)</label><input type="number" className="form-control" value={form.lateThreshold} onChange={(e) => setForm({ ...form, lateThreshold: parseInt(e.target.value) || 0 })} /></div>
              <div className="form-group"><label>Early Exit Threshold (min)</label><input type="number" className="form-control" value={form.earlyExitThreshold} onChange={(e) => setForm({ ...form, earlyExitThreshold: parseInt(e.target.value) || 0 })} /></div>
            </div>
            <button className="btn btn-primary" onClick={addShift}>Create Shift</button>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Shift Details</h3>
            {shifts.map((s) => (
              <div key={s.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 500 }}>{s.name} <span className="badge badge-info">{s.type}</span></div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                  {s.startTime} - {s.endTime} · {s.breakMinutes}min break · Late: {s.lateThreshold}min
                </div>
              </div>
            ))}
            {shifts.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No shifts</p>}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ShiftsPage() {
  return <AuthProvider><ShiftsContent /></AuthProvider>;
}
