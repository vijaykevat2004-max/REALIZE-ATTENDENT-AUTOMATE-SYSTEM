import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "employees";
  switch (type) {
    case "employees": {
      const data = await prisma.employee.findMany({ orderBy: { firstName: "asc" } });
      return NextResponse.json({ data, fields: ["employeeCode", "firstName", "lastName", "email", "mobile", "department", "designation", "status", "joinDate"] });
    }
    case "attendance": {
      const start = searchParams.get("startDate"); const end = searchParams.get("endDate");
      const where: any = {}; if (start && end) where.date = { gte: start, lte: end };
      const data = await prisma.attendanceLog.findMany({ where, include: { employee: { select: { employeeCode: true, firstName: true, lastName: true, department: true } } }, orderBy: { date: "desc" } });
      return NextResponse.json({ data, fields: ["employeeCode", "name", "department", "date", "inTime", "outTime", "status", "lateMinutes"] });
    }
    case "payroll": {
      const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));
      const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
      const data = await prisma.payrollRecord.findMany({ where: { month, year }, include: { employee: { select: { employeeCode: true, firstName: true, lastName: true, department: true } } } });
      return NextResponse.json({ data, fields: ["employeeCode", "name", "department", "basic", "grossSalary", "totalDeductions", "netSalary", "status"] });
    }
    case "leaves": {
      const data = await prisma.leaveRequest.findMany({ include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } }, orderBy: { createdAt: "desc" } });
      return NextResponse.json({ data, fields: ["employeeCode", "name", "leaveType", "startDate", "endDate", "days", "status"] });
    }
    default: return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
}
