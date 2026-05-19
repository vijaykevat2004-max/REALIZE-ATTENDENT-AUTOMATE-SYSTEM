import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empId = searchParams.get("employeeId");
    const where: any = {};
    if (empId) where.employeeId = empId;
    const data = await prisma.leaveBalance.findMany({ where, include: { employee: { select: { id: true, firstName: true, lastName: true } }, leaveType: { select: { id: true, name: true, color: true, isPaid: true } } }, orderBy: { year: "desc" } });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
