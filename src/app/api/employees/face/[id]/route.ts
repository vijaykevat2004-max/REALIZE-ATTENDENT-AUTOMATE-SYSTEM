import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { faceEmbedding } = await req.json();
    const emp = await prisma.employee.update({ where: { id }, data: { faceEmbedding } });
    return NextResponse.json({ success: true, employeeId: emp.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const emp = await prisma.employee.findUnique({ where: { id }, select: { id: true, faceEmbedding: true } });
    if (!emp) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ id: emp.id, hasFace: !!emp.faceEmbedding });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
