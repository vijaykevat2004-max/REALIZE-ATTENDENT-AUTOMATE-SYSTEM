"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

function SalaryContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState("payroll");
  const [payrolls, setPayrolls] = useState<any[]>([]);
  const [configs, setConfigs] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [selectedEmp, setSelectedEmp] = useState("");
  const [configForm, setConfigForm] = useState<any>({});
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  const fetchAll = () => {
    if (!token) return;
    fetch("/api/salary/generate", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : []).then((d) => setPayrolls(Array.isArray(d) ? d : []));
    fetch("/api/salary/config", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : []).then((d) => setConfigs(Array.isArray(d) ? d : []));
    fetch("/api/employees", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : []).then(setEmployees);
  };

  useEffect(() => { if (token) fetchAll(); }, [token]);

  const generatePayroll = async () => {
    const res = await fetch("/api/salary/generate", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) { alert("Payroll generated!"); fetchAll(); }
    else { const d = await res.json(); alert(d.error || "Failed"); }
  };

  const saveConfig = async () => {
    if (!selectedEmp) return;
    const res = await fetch("/api/salary/config", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ employeeId: selectedEmp, ...configForm }),
    });
    if (res.ok) { alert("Config saved!"); fetchAll(); }
    else { const d = await res.json(); alert(d.error || "Failed"); }
  };

  const loadConfig = (empId: string) => {
    setSelectedEmp(empId);
    const cfg = configs.find((c: any) => c.employeeId === empId);
    if (cfg) {
      setConfigForm({
        basic: cfg.basic, hra: cfg.hra, da: cfg.da, conveyance: cfg.conveyance,
        medical: cfg.medical, specialAllowance: cfg.specialAllowance,
        pfPercent: cfg.pfPercent, professionalTax: cfg.professionalTax,
      });
    } else {
      setConfigForm({ basic: 0, hra: 0, da: 0, conveyance: 0, medical: 0, specialAllowance: 0, pfPercent: 12, professionalTax: 200 });
    }
  };

  if (authLoading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Salary</h1>
          {tab === "payroll" && <button className="btn btn-primary" onClick={generatePayroll}>Generate Payroll</button>}
        </div>
        <div className="tabs">
          <div className={`tab ${tab === "payroll" ? "active" : ""}`} onClick={() => setTab("payroll")}>Payroll</div>
          <div className={`tab ${tab === "config" ? "active" : ""}`} onClick={() => setTab("config")}>Salary Config</div>
        </div>

        {tab === "payroll" && (
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Employee</th><th>Month</th><th>Gross</th><th>Deductions</th><th>Net</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {payrolls.map((p) => (
                    <tr key={p.id}>
                      <td>{p.employee?.firstName} {p.employee?.lastName}</td>
                      <td>{monthNames[p.month - 1]} {p.year}</td>
                      <td>₹{p.grossSalary?.toLocaleString()}</td>
                      <td style={{ color: "var(--danger)" }}>₹{p.totalDeductions?.toLocaleString()}</td>
                      <td style={{ fontWeight: 600 }}>₹{p.netSalary?.toLocaleString()}</td>
                      <td><span className={`badge badge-${p.status === "PAID" ? "success" : "info"}`}>{p.status}</span></td>
                    </tr>
                  ))}
                  {payrolls.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>No payroll records. Click generate.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "config" && (
          <div className="grid-2">
            <div className="card">
              <h3 style={{ marginBottom: 12, fontSize: 15 }}>Employees</h3>
              {employees.map((e) => (
                <div
                  key={e.id}
                  style={{ padding: "8px 12px", cursor: "pointer", borderRadius: 6, background: selectedEmp === e.id ? "var(--primary)" : "transparent", marginBottom: 4 }}
                  onClick={() => loadConfig(e.id)}
                >
                  {e.firstName} {e.lastName} - {e.employeeCode}
                </div>
              ))}
            </div>
            <div className="card">
              <h3 style={{ marginBottom: 12, fontSize: 15 }}>Salary Configuration</h3>
              {selectedEmp ? (
                <div>
                  {["basic","hra","da","conveyance","medical","specialAllowance","pfPercent","professionalTax"].map((field) => (
                    <div className="form-group" key={field}>
                      <label style={{ textTransform: "capitalize" }}>{field.replace(/([A-Z])/g, " $1")}</label>
                      <input type="number" className="form-control" value={(configForm as any)[field] || 0}
                        onChange={(e) => setConfigForm((f: any) => ({ ...f, [field]: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                  ))}
                  <button className="btn btn-primary" onClick={saveConfig}>Save Config</button>
                </div>
              ) : <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Select an employee</p>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SalaryPage() {
  return <AuthProvider><SalaryContent /></AuthProvider>;
}
