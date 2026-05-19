import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const where: any = {};
    if (searchParams.get("date")) where.date = searchParams.get("date");
    if (searchParams.get("employeeId")) where.employeeId = searchParams.get("employeeId");
    if (searchParams.get("status")) where.status = searchParams.get("status");
    if (searchParams.get("startDate") && searchParams.get("endDate")) {
      where.date = { gte: searchParams.get("startDate"), lte: searchParams.get("endDate") };
    }
    const logs = await prisma.attendanceLog.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: true, photoUrl: true } } }, orderBy: { date: "desc" }, take: 100 });
    return NextResponse.json(logs);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const existing = await prisma.attendanceLog.findUnique({ where: { employeeId_date: { employeeId: data.employeeId, date: data.date } } });
    if (existing) {
      const updated = await prisma.attendanceLog.update({ where: { id: existing.id }, data });
      return NextResponse.json(updated);
    }
    const log = await prisma.attendanceLog.create({ data });
    return NextResponse.json(log, { status: 201 });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
