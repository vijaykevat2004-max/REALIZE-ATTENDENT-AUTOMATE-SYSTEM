import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() {
  const data = await prisma.salaryConfig.findMany({ include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: true } } } });
  return NextResponse.json(data);
}
export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const config = await prisma.salaryConfig.upsert({
      where: { employeeId: data.employeeId }, update: data, create: data,
    });
    return NextResponse.json(config, { status: 201 });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
