import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { status, remarks } = await req.json();
    const lr = await prisma.leaveRequest.update({ where: { id }, data: { status, remarks } });
    if (status === "APPROVED") {
      await prisma.leaveBalance.updateMany({
        where: { employeeId: lr.employeeId, leaveTypeId: lr.leaveTypeId },
        data: { used: { increment: lr.days } },
      });
    }
    return NextResponse.json(lr);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
