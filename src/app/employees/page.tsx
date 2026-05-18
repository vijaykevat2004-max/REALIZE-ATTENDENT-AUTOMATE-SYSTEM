"use client";
import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import Link from "next/link";

function EmployeesContent() {
  const { token, loading: authLoading } = useAuth();
  const router = useRouter();
  const [employees, setEmployees] = useState<any[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!authLoading && !token) router.push("/login");
  }, [authLoading, token, router]);

  useEffect(() => {
    if (token) {
      fetch("/api/employees", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.ok ? r.json() : [])
        .then(setEmployees)
        .catch(() => {});
    }
  }, [token]);

  const filtered = employees.filter((e) =>
    `${e.firstName} ${e.lastName} ${e.employeeCode} ${e.department}`
      .toLowerCase().includes(search.toLowerCase())
  );

  if (authLoading) return <div className="loading-wrap"><div className="spinner" /></div>;
  if (!token) return null;

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>Employees</h1>
          <Link href="/employees/new" className="btn btn-primary">+ Add Employee</Link>
        </div>
        <div className="card" style={{ marginBottom: 16 }}>
          <input
            type="text"
            className="form-control"
            placeholder="Search by name, code, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>Shift</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td>{e.employeeCode}</td>
                    <td>{e.firstName} {e.lastName}</td>
                    <td>{e.department}</td>
                    <td>{e.designation}</td>
                    <td>{e.shiftType}</td>
                    <td><span className={`badge badge-${e.status === "ACTIVE" ? "success" : "danger"}`}>{e.status}</span></td>
                    <td>
                      <Link href={`/employees/${e.id}`} className="btn btn-outline btn-sm">Edit</Link>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)", padding: 40 }}>No employees found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function EmployeesPage() {
  return <AuthProvider><EmployeesContent /></AuthProvider>;
}
