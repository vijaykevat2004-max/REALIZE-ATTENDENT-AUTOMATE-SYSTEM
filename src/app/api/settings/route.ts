import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() {
  try {
    return NextResponse.json({
      companyName: "HRMS Pvt Ltd",
      workingDays: "Mon-Sat",
      lateGraceMinutes: 15,
      earlyExitThreshold: 60,
      overtimeRate: 1.5
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
export async function PUT(req: NextRequest) {
  const data = await req.json();
  return NextResponse.json({ ...data, updated: true });
}
