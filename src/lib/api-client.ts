const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(status: number, data: any) {
    super(`API Error ${status}`);
    this.status = status;
    this.data = data;
  }
}

async function fetchAPI<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(options.headers as any) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, { ...options, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data);
  }
  return res.json();
}

// Auth
export const login = (email: string, password: string) =>
  fetchAPI<{ token: string; user: { id: string; name: string; email: string; role: string } }>("/auth/login", {
    method: "POST", body: JSON.stringify({ email, password }),
  });

// Employees
export const getEmployees = (params?: { search?: string; department?: string; status?: string }) => {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.department) qs.set("department", params.department);
  if (params?.status) qs.set("status", params.status);
  const query = qs.toString();
  return fetchAPI<any[]>(`/employees${query ? `?${query}` : ""}`);
};

export const getEmployee = (id: string) => fetchAPI<any>(`/employees/${id}`);

export const createEmployee = (data: any) =>
  fetchAPI<any>("/employees", { method: "POST", body: JSON.stringify(data) });

export const updateEmployee = (id: string, data: any) =>
  fetchAPI<any>(`/employees/${id}`, { method: "PUT", body: JSON.stringify(data) });

export const deleteEmployee = (id: string) =>
  fetchAPI<any>(`/employees/${id}`, { method: "DELETE" });

// Attendance
export const markAttendance = (data: { employeeId: string; date: string; inTime?: string; outTime?: string; status?: string; source?: string; photoUrl?: string; location?: string }) =>
  fetchAPI<any>("/attendance", { method: "POST", body: JSON.stringify(data) });

export const getAttendance = (params?: { date?: string; employeeId?: string; status?: string; startDate?: string; endDate?: string }) => {
  const qs = new URLSearchParams();
  if (params?.date) qs.set("date", params.date);
  if (params?.employeeId) qs.set("employeeId", params.employeeId);
  if (params?.status) qs.set("status", params.status);
  if (params?.startDate) qs.set("startDate", params.startDate);
  if (params?.endDate) qs.set("endDate", params.endDate);
  const query = qs.toString();
  return fetchAPI<any[]>(`/attendance${query ? `?${query}` : ""}`);
};

export const markWebcamAttendance = (data: { employeeId: string; faceEmbedding: string }) =>
  fetchAPI<any>("/attendance/webcam", { method: "POST", body: JSON.stringify(data) });

// Salary
export const getSalaryConfigs = () => fetchAPI<any[]>("/salary/config");
export const getSalaryConfig = (id: string) => fetchAPI<any>(`/salary/config/${id}`);
export const saveSalaryConfig = (data: any) =>
  fetchAPI<any>("/salary/config", { method: "POST", body: JSON.stringify(data) });
export const generatePayroll = (month: number, year: number) =>
  fetchAPI<any>("/salary/generate", { method: "POST", body: JSON.stringify({ month, year }) });
export const getPayrolls = (month?: number, year?: number) => {
  const qs = new URLSearchParams();
  if (month) qs.set("month", String(month));
  if (year) qs.set("year", String(year));
  const query = qs.toString();
  return fetchAPI<any[]>(`/salary/generate${query ? `?${query}` : ""}`);
};
export const markPayrollPaid = (id: string) =>
  fetchAPI<any>(`/salary/generate/${id}`, { method: "PUT", body: JSON.stringify({ status: "PAID" }) });

// Shifts
export const getShifts = () => fetchAPI<any[]>("/shifts");
export const createShift = (data: any) => fetchAPI<any>("/shifts", { method: "POST", body: JSON.stringify(data) });
export const updateShift = (id: string, data: any) =>
  fetchAPI<any>(`/shifts/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteShift = (id: string) => fetchAPI<any>(`/shifts/${id}`, { method: "DELETE" });

// Holidays
export const getHolidays = () => fetchAPI<any[]>("/holidays");
export const createHoliday = (data: any) => fetchAPI<any>("/holidays", { method: "POST", body: JSON.stringify(data) });
export const updateHoliday = (id: string, data: any) =>
  fetchAPI<any>(`/holidays/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteHoliday = (id: string) => fetchAPI<any>(`/holidays/${id}`, { method: "DELETE" });

// Leaves
export const getLeaveTypes = () => fetchAPI<any[]>("/leaves/types");
export const createLeaveType = (data: any) => fetchAPI<any>("/leaves/types", { method: "POST", body: JSON.stringify(data) });
export const getLeaveBalances = (employeeId?: string) => {
  const qs = employeeId ? `?employeeId=${employeeId}` : "";
  return fetchAPI<any[]>(`/leaves/balance${qs}`);
};
export const getLeaveRequests = (params?: { status?: string; employeeId?: string }) => {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.employeeId) qs.set("employeeId", params.employeeId);
  const query = qs.toString();
  return fetchAPI<any[]>(`/leaves/request${query ? `?${query}` : ""}`);
};
export const createLeaveRequest = (data: any) =>
  fetchAPI<any>("/leaves/request", { method: "POST", body: JSON.stringify(data) });
export const approveLeave = (id: string, status: string, remarks?: string) =>
  fetchAPI<any>(`/leaves/approve/${id}`, { method: "PUT", body: JSON.stringify({ status, remarks }) });

// Dashboard
export const getDashboard = () => fetchAPI<any>("/dashboard");

// Settings
export const getSettings = () => fetchAPI<any>("/settings");
export const updateSettings = (data: any) => fetchAPI<any>("/settings", { method: "PUT", body: JSON.stringify(data) });

// Reports
export const exportReport = (type: string, params?: any) => {
  const qs = new URLSearchParams();
  if (params) Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
  const query = qs.toString();
  return fetchAPI<any>(`/reports/export?type=${type}${query ? `&${query}` : ""}`);
};
