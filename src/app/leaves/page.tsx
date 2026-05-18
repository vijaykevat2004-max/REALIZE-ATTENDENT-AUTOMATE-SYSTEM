"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

function LeavesContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState("requests");
  const [requests, setRequests] = useState<any[]>([]);
  const [balances, setBalances] = useState<any[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeMax, setNewTypeMax] = useState("12");

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  const fetchAll = () => {
    if (!token) return;
    fetch("/api/leaves/request", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : []).then((d) => setRequests(Array.isArray(d) ? d : []));
    fetch("/api/leaves/balance", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : []).then((d) => setBalances(Array.isArray(d) ? d : []));
    fetch("/api/leaves/types", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : []).then(setLeaveTypes);
    fetch("/api/employees", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : []).then(setEmployees);
  };

  useEffect(() => { if (token) fetchAll(); }, [token]);

  const submitRequest = async () => {
    if (!employeeId || !leaveTypeId || !fromDate || !toDate) return alert("Fill all fields");
    const res = await fetch("/api/leaves/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ employeeId, leaveTypeId, fromDate, toDate, reason }),
    });
    if (res.ok) { alert("Leave requested!"); fetchAll(); }
    else { const d = await res.json(); alert(d.error || "Failed"); }
  };

  const approveLeave = async (id: string, status: string) => {
    await fetch(`/api/leaves/approve/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status }),
    });
    fetchAll();
  };

  const addLeaveType = async () => {
    if (!newTypeName) return;
    await fetch("/api/leaves/types", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newTypeName, maxDays: parseInt(newTypeMax), isPaid: true, carryForward: false, color: "#6366f1" }),
    });
    setNewTypeName("");
    fetchAll();
  };

  if (authLoading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  const daysDiff = (f: string, t: string) => {
    if (!f || !t) return 0;
    return Math.max(1, Math.floor((new Date(t).getTime() - new Date(f).getTime()) / 86400000) + 1);
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header"><h1>Leaves</h1></div>
        <div className="tabs">
          <div className={`tab ${tab === "requests" ? "active" : ""}`} onClick={() => setTab("requests")}>Requests</div>
          <div className={`tab ${tab === "apply" ? "active" : ""}`} onClick={() => setTab("apply")}>Apply Leave</div>
          <div className={`tab ${tab === "balances" ? "active" : ""}`} onClick={() => setTab("balances")}>Balances</div>
          <div className={`tab ${tab === "types" ? "active" : ""}`} onClick={() => setTab("types")}>Leave Types</div>
        </div>

        {tab === "requests" && (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Employee</th><th>Type</th><th>From</th><th>To</th><th>Days</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>{r.employee?.firstName} {r.employee?.lastName}</td>
                      <td>{r.leaveType?.name}</td>
                      <td>{r.fromDate}</td>
                      <td>{r.toDate}</td>
                      <td>{r.days || daysDiff(r.fromDate, r.toDate)}</td>
                      <td><span className={`badge badge-${r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "danger" : "warning"}`}>{r.status}</span></td>
                      <td>
                        {r.status === "PENDING" && (
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn-success btn-sm" onClick={() => approveLeave(r.id, "APPROVED")}>Approve</button>
                            <button className="btn btn-danger btn-sm" onClick={() => approveLeave(r.id, "REJECTED")}>Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {requests.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No requests</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "apply" && (
          <div className="card" style={{ maxWidth: 500 }}>
            <div className="form-group">
              <label>Employee</label>
              <select className="form-control" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">Select...</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Leave Type</label>
              <select className="form-control" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)}>
                <option value="">Select...</option>
                {leaveTypes.map((lt) => <option key={lt.id} value={lt.id}>{lt.name}</option>)}
              </select>
            </div>
            <div className="grid-2">
              <div className="form-group"><label>From</label><input type="date" className="form-control" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
              <div className="form-group"><label>To</label><input type="date" className="form-control" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
            </div>
            <div className="form-group"><label>Reason</label><textarea className="form-control" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <button className="btn btn-primary" onClick={submitRequest}>Submit Request</button>
          </div>
        )}

        {tab === "balances" && (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Employee</th><th>Leave Type</th><th>Total</th><th>Used</th><th>Remaining</th></tr></thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.id}>
                      <td>{b.employee?.firstName} {b.employee?.lastName}</td>
                      <td>{b.leaveType?.name}</td>
                      <td>{b.total}</td>
                      <td>{b.used}</td>
                      <td>{b.total - b.used}</td>
                    </tr>
                  ))}
                  {balances.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No balances</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "types" && (
          <div>
            <div className="card" style={{ marginBottom: 16, maxWidth: 500 }}>
              <div className="grid-3">
                <div className="form-group"><label>Name</label><input className="form-control" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)} /></div>
                <div className="form-group"><label>Max Days</label><input type="number" className="form-control" value={newTypeMax} onChange={(e) => setNewTypeMax(e.target.value)} /></div>
                <div className="form-group"><label>&nbsp;</label><button className="btn btn-primary" onClick={addLeaveType} style={{ width: "100%" }}>Add</button></div>
              </div>
            </div>
            <div className="card">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Max Days</th><th>Paid</th><th>Carry Forward</th></tr></thead>
                  <tbody>
                    {leaveTypes.map((lt) => (
                      <tr key={lt.id}>
                        <td><span style={{ color: lt.color }}>●</span> {lt.name}</td>
                        <td>{lt.maxDays}</td>
                        <td>{lt.isPaid ? "Yes" : "No"}</td>
                        <td>{lt.carryForward ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function LeavesPage() {
  return <AuthProvider><LeavesContent /></AuthProvider>;
}
