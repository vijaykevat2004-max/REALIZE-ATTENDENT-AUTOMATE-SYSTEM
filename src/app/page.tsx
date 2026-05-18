"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

function DashboardContent() {
  const { user, token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (token) {
      fetch("/api/dashboard", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : null)
        .then(setStats)
        .catch(() => {});
    }
  }, [token]);

  if (authLoading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  const cards = [
    { label: "Total Employees", value: stats?.totalEmployees ?? 0, sub: "Active workforce" },
    { label: "Present Today", value: stats?.presentToday ?? 0, sub: stats?.totalEmployees ? `${Math.round(stats.presentToday / stats.totalEmployees * 100)}% attendance` : "" },
    { label: "On Leave", value: stats?.onLeave ?? 0, sub: "Leave today" },
    { label: "Pending Payroll", value: stats?.pendingPayroll ?? 0, sub: "This month" },
  ];

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Dashboard</h1>
          <span style={{ color: "var(--text-muted)", fontSize: 14 }}>Welcome, {user?.name || user?.email}</span>
        </div>
        <div className="grid-4">
          {cards.map((c) => (
            <div key={c.label} className="stat-card card">
              <div className="label">{c.label}</div>
              <div className="value">{c.value}</div>
              <div className="sub">{c.sub}</div>
            </div>
          ))}
        </div>
        <div className="grid-2" style={{ marginTop: 24 }}>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Recent Attendance</h3>
            {stats?.recentAttendance?.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Employee</th><th>Date</th><th>Status</th><th>In</th><th>Out</th></tr>
                  </thead>
                  <tbody>
                    {stats.recentAttendance.map((a: any, i: number) => (
                      <tr key={i}>
                        <td>{a.employee?.firstName} {a.employee?.lastName}</td>
                        <td>{a.date}</td>
                        <td><span className={`badge badge-${a.status === "PRESENT" ? "success" : a.status === "LATE" ? "warning" : "danger"}`}>{a.status}</span></td>
                        <td>{a.inTime}</td>
                        <td>{a.outTime}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No data</p>}
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Salary Summary</h3>
            {stats?.salarySummary ? (
              <div>
                <div className="stat-card" style={{ padding: 0 }}>
                  <div className="label">Monthly Gross</div>
                  <div className="value">₹{stats.salarySummary.totalGross?.toLocaleString() ?? 0}</div>
                </div>
                <div className="stat-card" style={{ padding: 0, marginTop: 12 }}>
                  <div className="label">Monthly Net</div>
                  <div className="value">₹{stats.salarySummary.totalNet?.toLocaleString() ?? 0}</div>
                </div>
                <div className="stat-card" style={{ padding: 0, marginTop: 12 }}>
                  <div className="label">Total Deductions</div>
                  <div className="value" style={{ color: "var(--danger)" }}>₹{stats.salarySummary.totalDeductions?.toLocaleString() ?? 0}</div>
                </div>
              </div>
            ) : <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No data</p>}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function DashboardPage() {
  return <AuthProvider><DashboardContent /></AuthProvider>;
}
