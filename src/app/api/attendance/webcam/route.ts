import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import dayjs from "dayjs";
export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    if (data.employeeId) {
      const emp = await prisma.employee.findUnique({ where: { id: data.employeeId } });
      if (!emp) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      const today = dayjs().format("YYYY-MM-DD");
      const now = dayjs().format("HH:mm");
      const existing = await prisma.attendanceLog.findUnique({ where: { employeeId_date: { employeeId: data.employeeId, date: today } } });
      if (existing) {
        if (!existing.outTime) {
          const updated = await prisma.attendanceLog.update({ where: { id: existing.id }, data: { outTime: now, status: "PRESENT" } });
          return NextResponse.json({ message: "Exit marked", log: updated });
        }
        return NextResponse.json({ message: "Already marked", log: existing });
      }
      const log = await prisma.attendanceLog.create({ data: { employeeId: emp.id, date: today, inTime: now, status: "PRESENT", source: "WEBCAM" } });
      return NextResponse.json({ message: "Entry marked", log }, { status: 201 });
    }
    return NextResponse.json({ error: "No employee identified" }, { status: 400 });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
