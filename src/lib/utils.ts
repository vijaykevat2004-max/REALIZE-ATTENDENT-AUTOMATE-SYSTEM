export function formatCurrency(amount: number) {
  return "₹" + amount.toLocaleString("en-IN");
}

export function formatDate(date: string) {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatTime(date: string) {
  if (!date) return "-";
  const d = new Date(date);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function minutesToTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function timeToMinutes(time: string) {
  if (!time) return 0;
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function calculateLateMinutes(shiftStart: string, actualInTime: string) {
  return Math.max(0, timeToMinutes(actualInTime) - timeToMinutes(shiftStart));
}

export function calculateGross(config: {
  basic: number; hra: number; da: number; conveyance: number;
  medical: number; specialAllowance: number; bonus: number; otherAllowance: number;
}) {
  return config.basic + config.hra + config.da + config.conveyance +
    config.medical + config.specialAllowance + config.bonus + config.otherAllowance;
}

export function calculateNet(gross: number, deductions: number, overtime: number) {
  return Math.max(0, gross - deductions + overtime);
}

export function generateEmployeeCode(lastCode?: string) {
  const num = lastCode ? parseInt(lastCode.replace("EMP", "")) + 1 : 1;
  return `EMP${String(num).padStart(5, "0")}`;
}
