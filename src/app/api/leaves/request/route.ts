import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const where: any = {};
    if (searchParams.get("status")) where.status = searchParams.get("status");
    if (searchParams.get("employeeId")) where.employeeId = searchParams.get("employeeId");
    const data = await prisma.leaveRequest.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: true } } }, orderBy: { createdAt: "desc" }, take: 50 });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const lr = await prisma.leaveRequest.create({ data: { ...data, status: "PENDING" } });
    return NextResponse.json(lr, { status: 201 });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
