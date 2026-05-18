import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function POST(req: NextRequest) {
  try {
    const records = await req.json();
    let count = 0;
    for (const r of records) {
      await prisma.attendanceLog.upsert({
        where: { employeeId_date: { employeeId: r.employeeId, date: r.date } },
        update: r, create: r,
      });
      count++;
    }
    return NextResponse.json({ success: true, count });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
