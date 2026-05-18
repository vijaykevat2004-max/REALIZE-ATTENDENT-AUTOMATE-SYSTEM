"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

function ReportsContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState("attendance");
  const [report, setReport] = useState<any[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (!token) return;
    let url = `/api/reports/export?type=${tab}`;
    if (fromDate) url += `&from=${fromDate}`;
    if (toDate) url += `&to=${toDate}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : []).then((d) => setReport(Array.isArray(d) ? d : []));
  }, [token, tab, fromDate, toDate]);

  const exportExcel = async () => {
    const url = `/api/reports/export?type=${tab}&format=excel${fromDate ? `&from=${fromDate}` : ""}${toDate ? `&to=${toDate}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${tab}-report.xlsx`;
      a.click();
    }
  };

  const columns: Record<string, string[]> = {
    attendance: ["Employee", "Date", "In Time", "Out Time", "Status", "Late Minutes"],
    salary: ["Employee", "Month", "Gross", "Deductions", "Net", "Status"],
    leaves: ["Employee", "Type", "From", "To", "Days", "Status"],
    employees: ["Code", "Name", "Department", "Designation", "Status"],
  };

  if (authLoading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  const tabs = ["attendance", "salary", "leaves", "employees"];

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Reports</h1>
          <button className="btn btn-primary" onClick={exportExcel}>📥 Export Excel</button>
        </div>
        <div className="tabs">
          {tabs.map((t) => <div key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)} style={{ textTransform: "capitalize" }}>{t}</div>)}
        </div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>From</label>
              <input type="date" className="form-control" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>To</label>
              <input type="date" className="form-control" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>{columns[tab]?.map((c) => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {report.map((r, i) => (
                  <tr key={i}>
                    {tab === "attendance" && (
                      <>
                        <td>{r.employee?.firstName} {r.employee?.lastName}</td>
                        <td>{r.date}</td>
                        <td>{r.inTime}</td>
                        <td>{r.outTime}</td>
                        <td><span className={`badge badge-${r.status === "PRESENT" ? "success" : r.status === "LATE" ? "warning" : "danger"}`}>{r.status}</span></td>
                        <td>{r.lateMinutes ? `${r.lateMinutes}m` : "-"}</td>
                      </>
                    )}
                    {tab === "salary" && (
                      <>
                        <td>{r.employee?.firstName} {r.employee?.lastName}</td>
                        <td>{r.month}/{r.year}</td>
                        <td>₹{r.grossSalary?.toLocaleString()}</td>
                        <td>₹{r.totalDeductions?.toLocaleString()}</td>
                        <td>₹{r.netSalary?.toLocaleString()}</td>
                        <td>{r.status}</td>
                      </>
                    )}
                    {tab === "leaves" && (
                      <>
                        <td>{r.employee?.firstName} {r.employee?.lastName}</td>
                        <td>{r.leaveType?.name}</td>
                        <td>{r.fromDate}</td>
                        <td>{r.toDate}</td>
                        <td>{r.days}</td>
                        <td>{r.status}</td>
                      </>
                    )}
                    {tab === "employees" && (
                      <>
                        <td>{r.employeeCode}</td>
                        <td>{r.firstName} {r.lastName}</td>
                        <td>{r.department}</td>
                        <td>{r.designation}</td>
                        <td><span className={`badge badge-${r.status === "ACTIVE" ? "success" : "danger"}`}>{r.status}</span></td>
                      </>
                    )}
                  </tr>
                ))}
                {report.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function ReportsPage() {
  return <AuthProvider><ReportsContent /></AuthProvider>;
}
