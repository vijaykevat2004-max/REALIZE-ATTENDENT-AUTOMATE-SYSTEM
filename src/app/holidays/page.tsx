"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

function HolidaysContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [holidays, setHolidays] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [type, setType] = useState("Public");

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (token) {
      fetch("/api/holidays", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : []).then((d) => setHolidays(Array.isArray(d) ? d : []));
    }
  }, [token]);

  const addHoliday = async () => {
    if (!name || !date) return;
    const res = await fetch("/api/holidays", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, date, type, isPaid: true }),
    });
    if (res.ok) {
      setName(""); setDate(""); setType("Public");
      const r = await fetch("/api/holidays", { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setHolidays(await r.json());
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
        <div className="page-header"><h1>Holidays</h1></div>
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Add Holiday</h3>
            <div className="form-group"><label>Name</label><input className="form-control" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="form-group"><label>Date</label><input type="date" className="form-control" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="form-group"><label>Type</label>
              <select className="form-control" value={type} onChange={(e) => setType(e.target.value)}>
                <option>Public</option><option>Optional</option><option>Company</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={addHoliday}>Add Holiday</button>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Upcoming Holidays</h3>
            {holidays
              .filter((h) => new Date(h.date) >= new Date(new Date().toDateString()))
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
              .slice(0, 5)
              .map((h) => (
                <div key={h.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{h.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{h.type}</div>
                  </div>
                  <div style={{ color: "var(--accent)" }}>{new Date(h.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                </div>
              ))}
            {holidays.filter((h) => new Date(h.date) >= new Date()).length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No upcoming holidays</p>}
          </div>
        </div>
        <div className="card">
          <h3 style={{ marginBottom: 12, fontSize: 15 }}>All Holidays</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Date</th><th>Type</th><th>Paid</th></tr></thead>
              <tbody>
                {holidays.map((h) => (
                  <tr key={h.id}>
                    <td>{h.name}</td>
                    <td>{new Date(h.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td><span className="badge badge-info">{h.type}</span></td>
                    <td>{h.isPaid ? "Yes" : "No"}</td>
                  </tr>
                ))}
                {holidays.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No holidays</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function HolidaysPage() {
  return <AuthProvider><HolidaysContent /></AuthProvider>;
}
