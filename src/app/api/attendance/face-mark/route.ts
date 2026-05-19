import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeShiftTimes, minutesToHM } from "@/lib/attendanceUtils";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") || new Date().toISOString().split("T")[0];
  const employeeId = searchParams.get("employeeId") || "";
  const where: any = { date };
  if (employeeId) where.employeeId = employeeId;
  const logs = await prisma.faceDetectionLog.findMany({
    where,
    include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: true, photoUrl: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(logs);
}

export async function POST(req: NextRequest) {
  try {
    const { employeeId } = await req.json();
    if (!employeeId) return NextResponse.json({ error: "employeeId required" }, { status: 400 });

    const now = new Date();
    const date = now.toISOString().split("T")[0];
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const timeStr = `${hh}:${mm}`;
    const totalMinutes = now.getHours() * 60 + now.getMinutes();

    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    if (employee.status !== "ACTIVE") return NextResponse.json({ error: "Employee not active" }, { status: 400 });

    const { startMinutes, endMinutes, lateThreshold, earlyExitThreshold } = await getEmployeeShiftTimes(employee);

    const allToday = await prisma.faceDetectionLog.findMany({
      where: { employeeId, date },
      orderBy: { createdAt: "asc" },
    });

    let type = allToday.length === 0 ? "CHECK_IN" : allToday[allToday.length - 1].type === "CHECK_IN" ? "CHECK_OUT" : "CHECK_IN";

    await prisma.faceDetectionLog.create({
      data: { employeeId, date, time: timeStr, type },
    });

    if (type === "CHECK_IN") {
      const lateMin = Math.max(0, totalMinutes - startMinutes - lateThreshold);
      await prisma.attendanceLog.upsert({
        where: { employeeId_date: { employeeId, date } },
        create: { employeeId, date, inTime: timeStr, status: lateMin > 0 ? "LATE" : "PRESENT", lateMinutes: lateMin, source: "FACE" },
        update: { inTime: timeStr, status: lateMin > 0 ? "LATE" : "PRESENT", lateMinutes: lateMin, source: "FACE" },
      });
    } else {
      const earlyMin = Math.max(0, endMinutes - earlyExitThreshold - totalMinutes);
      const existing = await prisma.attendanceLog.findUnique({
        where: { employeeId_date: { employeeId, date } },
      });
      if (existing) {
        await prisma.attendanceLog.update({
          where: { id: existing.id },
          data: { outTime: timeStr, earlyExitMinutes: earlyMin, source: "FACE" },
        });
      }
    }

    const updatedLog = await prisma.attendanceLog.findUnique({
      where: { employeeId_date: { employeeId, date } },
    });

    return NextResponse.json({
      success: true,
      type,
      time: timeStr,
      employeeId,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      attendance: updatedLog,
      detectionsToday: allToday.length + 1,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
