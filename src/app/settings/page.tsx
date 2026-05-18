"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";

function SettingsContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState("employees");

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  if (authLoading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header"><h1>Settings</h1></div>
        <div className="tabs">
          <div className={`tab ${tab === "employees" ? "active" : ""}`} onClick={() => setTab("employees")}>Employees</div>
          <div className={`tab ${tab === "system" ? "active" : ""}`} onClick={() => setTab("system")}>System</div>
        </div>
        {tab === "employees" && (
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Employee Settings</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Manage employee configuration from the Employees section.</p>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label>Auto-generate Employee Code</label>
              <select className="form-control"><option>EMP-{new Date().getFullYear()}-XXXX</option></select>
            </div>
          </div>
        )}
        {tab === "system" && (
          <div className="card">
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>System Settings</h3>
            <div className="form-group">
              <label>Company Name</label>
              <input className="form-control" defaultValue="Your Company Pvt. Ltd." />
            </div>
            <div className="form-group">
              <label>Working Days per Month</label>
              <input className="form-control" type="number" defaultValue={26} />
            </div>
            <div className="form-group">
              <label>Late Penalty (per minute)</label>
              <input className="form-control" type="number" defaultValue={1} />
            </div>
            <button className="btn btn-primary">Save Settings</button>
          </div>
        )}
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return <AuthProvider><SettingsContent /></AuthProvider>;
}
