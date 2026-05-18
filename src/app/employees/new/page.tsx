"use client";
import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { useRouter } from "next/navigation";
import Link from "next/link";

function EmployeeForm({ editId }: { editId?: string }) {
  const { token } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", mobile: "", aadhaar: "", pan: "",
    gender: "MALE", maritalStatus: "SINGLE", dateOfBirth: "", bloodGroup: "",
    address: "", city: "", state: "", pincode: "", emergencyContact: "", emergencyPhone: "",
    bankName: "", bankAccount: "", bankIfsc: "", department: "", designation: "",
    shiftType: "GENERAL", joinDate: "",
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to save");
      }
      router.push("/employees");
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  };

  const fields = [
    { label: "First Name", key: "firstName", required: true },
    { label: "Last Name", key: "lastName", required: true },
    { label: "Email", key: "email", type: "email", required: true },
    { label: "Mobile", key: "mobile" },
    { label: "Aadhaar", key: "aadhaar" },
    { label: "PAN", key: "pan" },
    { label: "Gender", key: "gender", type: "select", options: ["MALE", "FEMALE", "OTHER"] },
    { label: "Marital Status", key: "maritalStatus", type: "select", options: ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"] },
    { label: "Date of Birth", key: "dateOfBirth", type: "date" },
    { label: "Blood Group", key: "bloodGroup" },
    { label: "Address", key: "address", type: "textarea" },
    { label: "City", key: "city" },
    { label: "State", key: "state" },
    { label: "Pincode", key: "pincode" },
    { label: "Emergency Contact", key: "emergencyContact" },
    { label: "Emergency Phone", key: "emergencyPhone" },
    { label: "Bank Name", key: "bankName" },
    { label: "Bank Account", key: "bankAccount" },
    { label: "Bank IFSC", key: "bankIfsc" },
    { label: "Department", key: "department" },
    { label: "Designation", key: "designation" },
    { label: "Shift Type", key: "shiftType", type: "select", options: ["GENERAL", "MORNING", "NIGHT"] },
    { label: "Join Date", key: "joinDate", type: "date" },
  ];

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <div className="page-header">
          <h1>{editId ? "Edit Employee" : "Add Employee"}</h1>
          <Link href="/employees" className="btn btn-outline">← Back</Link>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="card">
          <form onSubmit={handleSubmit}>
            <div className="grid-3">
              {fields.map((f) => (
                <div className="form-group" key={f.key}>
                  <label>{f.label}</label>
                  {f.type === "select" ? (
                    <select className="form-control" value={(form as any)[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                      {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea className="form-control" value={(form as any)[f.key]} onChange={(e) => set(f.key, e.target.value)} />
                  ) : (
                    <input type={f.type || "text"} className="form-control" placeholder={f.label} value={(form as any)[f.key]} onChange={(e) => set(f.key, e.target.value)} required={f.required} />
                  )}
                </div>
              ))}
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving..." : editId ? "Update Employee" : "Create Employee"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

function NewEmployeePage() {
  return <EmployeeForm />;
}

export default function Page() {
  return <AuthProvider><NewEmployeePage /></AuthProvider>;
}
