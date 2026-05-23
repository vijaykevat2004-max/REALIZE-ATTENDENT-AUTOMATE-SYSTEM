"use client";
import { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

interface Emp {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  department: string;
}

function QrCardsContent() {
  const { token, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Emp[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!loading && !token) router.push("/login");
  }, [loading, token, router]);

  useEffect(() => {
    if (!token) return;
    fetch("/api/employees", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        const arr = Array.isArray(d) ? d : [];
        setRows(arr.map((e: any) => ({
          id: e.id,
          firstName: e.firstName,
          lastName: e.lastName,
          employeeCode: e.employeeCode,
          department: e.department,
        })));
      })
      .catch(() => setRows([]));
  }, [token]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) ||
      r.employeeCode.toLowerCase().includes(q) ||
      (r.department || "").toLowerCase().includes(q)
    );
  }, [rows, query]);

  if (loading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>📇 QR Cards</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name/code/department"
              style={{ minWidth: 240 }}
            />
            <button className="btn btn-outline" onClick={() => window.print()}>🖨 Print</button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            QR data format: <code>HRMSQR:EMP_CODE</code>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
          {filtered.map((e) => {
            const qrValue = `HRMSQR:${e.employeeCode}`;
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrValue)}`;
            return (
              <div key={e.id} className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 8 }}>
                <img src={qrUrl} alt={`QR ${e.employeeCode}`} width={180} height={180} />
                <div style={{ fontWeight: 700 }}>{e.firstName} {e.lastName}</div>
                <div style={{ fontFamily: "monospace" }}>{e.employeeCode}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{e.department}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{qrValue}</div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

export default function QrCardsPage() {
  return (
    <AuthProvider>
      <QrCardsContent />
    </AuthProvider>
  );
}
