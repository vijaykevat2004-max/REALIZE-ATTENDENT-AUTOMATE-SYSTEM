"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

interface ActiveEmployee {
  id: string;
  inTime: string;
  photoUrl?: string | null;
  employee: {
    id: string; firstName: string; lastName: string; employeeCode: string; department: string; photoUrl: string | null;
  };
}

interface TodayLog {
  id: string; employeeId: string; date: string; time: string; type: string;
  employee?: { firstName: string; lastName: string; employeeCode: string; department: string; photoUrl: string | null };
}

function LiveContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [active, setActive] = useState<ActiveEmployee[]>([]);
  const [todayLogs, setTodayLogs] = useState<TodayLog[]>([]);
  const [stats, setStats] = useState({ total: 0, checkedIn: 0, checkedOut: 0 });

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (!token) return;
    const fetchData = async () => {
      const today = new Date().toISOString().split("T")[0];
      try {
        const [activeRes, logsRes] = await Promise.all([
          fetch(`/api/attendance/face-mark?date=${today}&mode=active`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`/api/attendance/face-mark?date=${today}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        if (activeRes.ok) setActive(await activeRes.json());
        if (logsRes.ok) {
          const logs: TodayLog[] = await logsRes.json();
          setTodayLogs(logs);
          setStats({
            total: logs.reduce((acc: Set<string>, l: TodayLog) => acc.add(l.employeeId), new Set()).size,
            checkedIn: logs.filter((l) => l.type === "CHECK_IN").length,
            checkedOut: logs.filter((l) => l.type === "CHECK_OUT").length,
          });
        }
      } catch {}
    };
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [token]);

  const n = new Date();
  const dateStr = n.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const timeStr = n.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  if (authLoading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Live Attendance Dashboard</h1>
          <div style={{ fontSize: 14, color: "var(--text-muted)" }}>{dateStr} · {timeStr} · Auto-refreshes every 5s</div>
        </div>

        <div className="grid-3" style={{ marginBottom: 24 }}>
          <div className="card" style={{ textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: "var(--success)" }}>{active.length}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>In Office Now</div>
          </div>
          <div className="card" style={{ textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: "var(--accent)" }}>{stats.checkedIn}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Total Check-ins Today</div>
          </div>
          <div className="card" style={{ textAlign: "center", padding: 24 }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: "var(--warning)" }}>{stats.checkedOut}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Total Check-outs Today</div>
          </div>
        </div>

        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>👤 Currently in Office</h3>
            <div style={{ maxHeight: 400, overflowY: "auto" }}>
              {active.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No one checked in yet today</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Employee</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Code</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Dept</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>In Since</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((a) => (
                      <tr key={a.id}>
                        <td style={{ padding: "6px 8px", display: "flex", alignItems: "center", gap: 8 }}>
                          {a.employee.photoUrl ? (
                            <img src={a.employee.photoUrl} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                          ) : (
                            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>👤</div>
                          )}
                          {a.employee.firstName} {a.employee.lastName}
                        </td>
                        <td style={{ padding: "6px 8px", fontSize: 12, color: "var(--text-muted)" }}>{a.employee.employeeCode}</td>
                        <td style={{ padding: "6px 8px", fontSize: 12 }}>{a.employee.department}</td>
                        <td style={{ padding: "6px 8px", fontSize: 12, color: "var(--success)" }}>✅ {a.inTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>📋 Live Activity Feed</h3>
            <div style={{ maxHeight: 400, overflowY: "auto", fontSize: 13 }}>
              {todayLogs.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No activity yet today</div>
              ) : (
                [...todayLogs].reverse().map((log) => (
                  <div key={log.id} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 8px", borderBottom: "1px solid var(--border)",
                    animation: "fadeIn 0.3s",
                  }}>
                    <span style={{ fontSize: 16 }}>
                      {log.type === "CHECK_IN" ? "✅" : "🚪"}
                    </span>
                    <span style={{ fontWeight: 600 }}>{log.employee?.firstName} {log.employee?.lastName}</span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{log.employee?.employeeCode}</span>
                    <span className={`badge ${log.type === "CHECK_IN" ? "badge-success" : "badge-accent"}`}>
                      {log.type === "CHECK_IN" ? "IN" : "OUT"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>{log.time}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function Page() {
  return <AuthProvider><LiveContent /></AuthProvider>;
}
