import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const employee = await prisma.employee.findUnique({ where: { id } });
    if (!employee) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(employee);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const data = await req.json();
    const emp = await prisma.employee.update({ where: { id }, data });
    return NextResponse.json(emp);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.employee.update({ where: { id }, data: { status: "INACTIVE" } });
  return NextResponse.json({ success: true });
}
