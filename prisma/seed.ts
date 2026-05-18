import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import dayjs from "dayjs";

const prisma = new PrismaClient();
const hash = (pw: string) => bcrypt.hashSync(pw, 10);

async function main() {
  await prisma.auditLog.create({ data: { userId: "system", action: "seed", entity: "system" } });

  const shifts = await Promise.all([
    prisma.shift.create({ data: { name: "General", type: "GENERAL", startTime: "09:00", endTime: "18:00", breakMinutes: 60, lateThreshold: 15, earlyExitThreshold: 30 } }),
    prisma.shift.create({ data: { name: "Morning", type: "MORNING", startTime: "06:00", endTime: "14:00", breakMinutes: 30, lateThreshold: 10, earlyExitThreshold: 20 } }),
    prisma.shift.create({ data: { name: "Night", type: "NIGHT", startTime: "22:00", endTime: "06:00", breakMinutes: 60, lateThreshold: 15, earlyExitThreshold: 30 } }),
  ]);
  console.log("Shifts:", shifts.length);

  const ltData = [
    { name: "Casual Leave", maxDays: 12, carryForward: false, isPaid: true, color: "#10B981" },
    { name: "Sick Leave", maxDays: 7, carryForward: false, isPaid: true, color: "#EF4444" },
    { name: "Earned Leave", maxDays: 15, carryForward: true, isPaid: true, color: "#3B82F6" },
    { name: "Maternity Leave", maxDays: 90, carryForward: false, isPaid: true, color: "#EC4899" },
    { name: "Compensatory Off", maxDays: 5, carryForward: false, isPaid: true, color: "#F59E0B" },
  ];
  const leaveTypes = [];
  for (const lt of ltData) {
    leaveTypes.push(await prisma.leaveType.create({ data: lt }));
  }
  console.log("Leave types:", leaveTypes.length);

  const hData = [
    { name: "Republic Day", date: "2026-01-26", type: "Public", isPaid: true },
    { name: "Holi", date: "2026-03-06", type: "Public", isPaid: true },
    { name: "Good Friday", date: "2026-04-03", type: "Public", isPaid: true },
    { name: "Independence Day", date: "2026-08-15", type: "Public", isPaid: true },
    { name: "Diwali", date: "2026-10-31", type: "Public", isPaid: true },
    { name: "Christmas", date: "2026-12-25", type: "Public", isPaid: true },
  ];
  for (const h of hData) await prisma.holiday.create({ data: h });
  console.log("Holidays:", hData.length);

  const empData = [
    { fn: "Amit", ln: "Sharma", em: "amit.sharma@company.com", mb: "9876543210", ad: "1234-5678-9012", pan: "ABCDE1234F", gen: "MALE", ms: "MARRIED", dob: "1990-05-15", bg: "O+", addr: "42, MG Road, Andheri East", cy: "Mumbai", st: "Maharashtra", pin: "400093", ec: "Suman Sharma", ep: "9876543211", bn: "HDFC Bank", ba: "50200012345678", bi: "HDFC0001234", dep: "Workshop", des: "Senior Technician", stype: "GENERAL", jd: "2020-06-01", basic: 35000, hra: 14000, da: 3000, conv: 2000, med: 1500, spec: 5000, pfP: 12 },
    { fn: "Priya", ln: "Patel", em: "priya.patel@company.com", mb: "9876543220", ad: "2234-5678-9012", pan: "BCDEF1235G", gen: "FEMALE", ms: "MARRIED", dob: "1992-08-20", bg: "A+", addr: "15, Satellite Road", cy: "Ahmedabad", st: "Gujarat", pin: "380015", ec: "Ravi Patel", ep: "9876543221", bn: "ICICI Bank", ba: "60200023456789", bi: "ICIC0005678", dep: "Assembly", des: "Team Lead", stype: "GENERAL", jd: "2019-03-15", basic: 42000, hra: 16800, da: 4000, conv: 2500, med: 1500, spec: 6000, pfP: 12 },
    { fn: "Rajesh", ln: "Kumar", em: "rajesh.kumar@company.com", mb: "9876543230", ad: "3234-5678-9012", pan: "CDEFG1236H", gen: "MALE", ms: "SINGLE", dob: "1995-11-10", bg: "B+", addr: "88, Sector 18", cy: "Noida", st: "Uttar Pradesh", pin: "201301", ec: "Sunita Kumar", ep: "9876543231", bn: "SBI", ba: "30200034567890", bi: "SBIN0001234", dep: "Quality", des: "QC Inspector", stype: "MORNING", jd: "2021-07-01", basic: 28000, hra: 11200, da: 2500, conv: 2000, med: 1500, spec: 3000, pfP: 12 },
    { fn: "Sneha", ln: "Reddy", em: "sneha.reddy@company.com", mb: "9876543240", ad: "4234-5678-9012", pan: "DEFGH1237I", gen: "FEMALE", ms: "SINGLE", dob: "1998-02-28", bg: "AB+", addr: "7-1-27, Ameerpet", cy: "Hyderabad", st: "Telangana", pin: "500016", ec: "Vikram Reddy", ep: "9876543241", bn: "Axis Bank", ba: "40200045678901", bi: "UTIB0005678", dep: "Fabrication", des: "Welder Grade 1", stype: "NIGHT", jd: "2022-01-10", basic: 25000, hra: 10000, da: 2000, conv: 1500, med: 1500, spec: 2500, pfP: 12 },
    { fn: "Vikram", ln: "Joshi", em: "vikram.joshi@company.com", mb: "9876543250", ad: "5234-5678-9012", pan: "EFGHI1238J", gen: "MALE", ms: "MARRIED", dob: "1988-09-05", bg: "B-", addr: "55, Law Garden", cy: "Vadodara", st: "Gujarat", pin: "390007", ec: "Anita Joshi", ep: "9876543251", bn: "Bank of Baroda", ba: "50200056789012", bi: "BARB0001234", dep: "Dispatch", des: "Supervisor", stype: "GENERAL", jd: "2018-06-15", basic: 38000, hra: 15200, da: 3500, conv: 2500, med: 1500, spec: 5500, pfP: 12 },
    { fn: "Pooja", ln: "Mehta", em: "pooja.mehta@company.com", mb: "9876543260", ad: "6234-5678-9012", pan: "FGHIJ1239K", gen: "FEMALE", ms: "MARRIED", dob: "1993-12-18", bg: "A-", addr: "12, Civil Lines", cy: "Jaipur", st: "Rajasthan", pin: "302006", ec: "Arun Mehta", ep: "9876543261", bn: "HDFC Bank", ba: "60200067890123", bi: "HDFC0005678", dep: "Workshop", des: "Machine Operator", stype: "GENERAL", jd: "2020-11-01", basic: 22000, hra: 8800, da: 2000, conv: 1500, med: 1500, spec: 2000, pfP: 12 },
  ];

  const employees = [];
  for (let i = 0; i < empData.length; i++) {
    const e = empData[i];
    const code = "EMP" + String(i + 1).padStart(5, "0");
    const emp = await prisma.employee.create({
      data: {
        employeeCode: code, firstName: e.fn, lastName: e.ln, email: e.em, mobile: e.mb,
        aadhaar: e.ad, pan: e.pan, gender: e.gen, maritalStatus: e.ms, dateOfBirth: e.dob,
        bloodGroup: e.bg, address: e.addr, city: e.cy, state: e.st, pincode: e.pin,
        emergencyContact: e.ec, emergencyPhone: e.ep, bankName: e.bn, bankAccount: e.ba,
        bankIfsc: e.bi, department: e.dep, designation: e.des, shiftType: e.stype,
        joinDate: e.jd, status: "ACTIVE",
      },
    });
    await prisma.salaryConfig.create({
      data: {
        employeeId: emp.id, basic: e.basic, hra: e.hra, da: e.da, conveyance: e.conv,
        medical: e.med, specialAllowance: e.spec, bonus: 0, otherAllowance: 0,
        pf: 0, pfPercent: e.pfP, esi: 0, tds: 0, professionalTax: 200,
        loanDeduction: 0, otherDeduction: 0, overtimeRate: 1.5, effectiveFrom: e.jd,
      },
    });
    for (const lt of leaveTypes) {
      await prisma.leaveBalance.create({
        data: { employeeId: emp.id, leaveTypeId: lt.id, year: 2026, total: lt.maxDays, used: 0 },
      });
    }
    employees.push(emp);
  }
  console.log("Employees:", employees.length);

  const today = dayjs();
  const statuses = ["PRESENT", "PRESENT", "LATE", "PRESENT", "PRESENT", "ABSENT", "PRESENT", "HALF_DAY", "PRESENT", "LATE", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT"];
  let attCount = 0;
  for (const emp of employees) {
    for (let i = 0; i < 20; i++) {
      const date = today.subtract(i, "day");
      const status = statuses[i % statuses.length];
      if (status === "ABSENT") continue;
      const inH = status === "LATE" ? 10 : 8 + Math.floor(Math.random() * 2);
      const inM = Math.floor(Math.random() * 55);
      const outH = status === "HALF_DAY" ? 13 : 17 + Math.floor(Math.random() * 2);
      const outM = Math.floor(Math.random() * 55);
      const lateM = status === "LATE" ? 15 + Math.floor(Math.random() * 30) : 0;
      try {
        await prisma.attendanceLog.create({
          data: {
            employeeId: emp.id, date: date.format("YYYY-MM-DD"),
            inTime: String(inH).padStart(2, "0") + ":" + String(inM).padStart(2, "0"),
            outTime: String(outH).padStart(2, "0") + ":" + String(outM).padStart(2, "0"),
            status, lateMinutes: lateM, earlyExitMinutes: 0, overtimeHours: 0,
            source: "MANUAL", location: "",
          },
        });
        attCount++;
      } catch { /* skip dup */ }
    }
  }
  console.log("Attendance logs:", attCount);

  for (const emp of employees) {
    const config = await prisma.salaryConfig.findUnique({ where: { employeeId: emp.id } });
    if (!config) continue;
    const gross = config.basic + config.hra + config.da + config.conveyance + config.medical + config.specialAllowance;
    const pfAmt = gross * (config.pfPercent || 12) / 100;
    const net = Math.max(0, gross - pfAmt - config.professionalTax);
    await prisma.payrollRecord.create({
      data: {
        employeeId: emp.id, month: today.month() + 1, year: today.year(),
        basic: config.basic, hra: config.hra, da: config.da, conveyance: config.conveyance,
        medical: config.medical, specialAllowance: config.specialAllowance,
        bonus: 0, otherAllowance: 0, grossSalary: gross,
        pf: pfAmt, esi: 0, tds: 0, professionalTax: config.professionalTax,
        loanDeduction: 0, otherDeduction: 0, lateDeduction: 0, leaveDeduction: 0,
        totalDeductions: pfAmt + config.professionalTax, overtimeAmount: 0, netSalary: net,
        status: "GENERATED", generatedAt: today.format("YYYY-MM-DD"),
      },
    });
  }
  console.log("Payroll records:", employees.length);

  console.log("\n==============================");
  console.log("SEED COMPLETE");
  console.log("Admin: admin@hrms.com / Admin@123");
  console.log("==============================");
}

main().catch(console.error).finally(() => prisma.$disconnect());
