import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import dayjs from "dayjs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const today = dayjs().format("YYYY-MM-DD");
    const thisMonth = dayjs().month() + 1;
    const thisYear = dayjs().year();
    const logs = await prisma.attendanceLog.findMany({ where: { date: today } });
    const present = logs.filter(l => l.status === "PRESENT" || l.status === "LATE").length;
    const late = logs.filter(l => l.status === "LATE").length;
    const absent = logs.filter(l => l.status === "ABSENT").length;
    const total = await prisma.employee.count({ where: { status: "ACTIVE" } });
    const payrolls = await prisma.payrollRecord.findMany({ where: { month: thisMonth, year: thisYear } });
    const totalPayroll = payrolls.reduce((s, p) => s + p.netSalary, 0);
    const pendingLeaves = await prisma.leaveRequest.count({ where: { status: "PENDING" } });
    const upcomingHolidays = await prisma.holiday.findMany({ where: { date: { gte: today } }, orderBy: { date: "asc" }, take: 5 });
    const recentAttendance = await prisma.attendanceLog.findMany({ where: { date: today }, include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } }, orderBy: { inTime: "asc" }, take: 15 });
    return NextResponse.json({ today: { present, absent, late, total }, payroll: { total: totalPayroll, count: payrolls.length }, pendingLeaves, upcomingHolidays, recentAttendance });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
