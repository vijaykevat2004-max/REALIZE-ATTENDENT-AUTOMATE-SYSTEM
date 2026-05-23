import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEmployeeShiftTimes } from "@/lib/attendanceUtils";

function extractEmployeeCode(qrData: string): string {
  const raw = (qrData || "").trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.employeeCode === "string") {
      return parsed.employeeCode.trim();
    }
  } catch {}

  if (raw.startsWith("HRMSQR:")) {
    return raw.slice("HRMSQR:".length).trim();
  }

  return raw;
}

export async function POST(req: NextRequest) {
  try {
    const { qrData } = await req.json();
    const employeeCode = extractEmployeeCode(qrData || "");
    if (!employeeCode) {
      return NextResponse.json({ error: "Invalid QR data" }, { status: 400 });
    }

    const now = new Date();
    const date = now.toISOString().split("T")[0];
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const timeStr = `${hh}:${mm}`;
    const totalMinutes = now.getHours() * 60 + now.getMinutes();

    const employee = await prisma.employee.findUnique({ where: { employeeCode } });
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    if (employee.status !== "ACTIVE") return NextResponse.json({ error: "Employee not active" }, { status: 400 });

    const { startMinutes, endMinutes, lateThreshold, earlyExitThreshold } = await getEmployeeShiftTimes(employee);

    const allToday = await prisma.faceDetectionLog.findMany({
      where: { employeeId: employee.id, date },
      orderBy: { createdAt: "asc" },
    });

    const type = allToday.length === 0
      ? "CHECK_IN"
      : allToday[allToday.length - 1].type === "CHECK_IN"
        ? "CHECK_OUT"
        : "CHECK_IN";

    await prisma.faceDetectionLog.create({
      data: { employeeId: employee.id, date, time: timeStr, type },
    });

    if (type === "CHECK_IN") {
      const lateMin = Math.max(0, totalMinutes - startMinutes - lateThreshold);
      await prisma.attendanceLog.upsert({
        where: { employeeId_date: { employeeId: employee.id, date } },
        create: {
          employeeId: employee.id,
          date,
          inTime: timeStr,
          status: lateMin > 0 ? "LATE" : "PRESENT",
          lateMinutes: lateMin,
          source: "QR",
        },
        update: {
          inTime: timeStr,
          status: lateMin > 0 ? "LATE" : "PRESENT",
          lateMinutes: lateMin,
          source: "QR",
        },
      });
    } else {
      const earlyMin = Math.max(0, endMinutes - earlyExitThreshold - totalMinutes);
      const existing = await prisma.attendanceLog.findUnique({
        where: { employeeId_date: { employeeId: employee.id, date } },
      });
      if (existing) {
        await prisma.attendanceLog.update({
          where: { id: existing.id },
          data: { outTime: timeStr, earlyExitMinutes: earlyMin, source: "QR" },
        });
      }
    }

    return NextResponse.json({
      success: true,
      type,
      time: timeStr,
      employeeId: employee.id,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeCode: employee.employeeCode,
      source: "QR",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed to mark QR" }, { status: 500 });
  }
}
