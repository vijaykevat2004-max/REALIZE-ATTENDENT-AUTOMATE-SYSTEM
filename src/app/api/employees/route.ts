import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const department = searchParams.get("department") || "";
    const status = searchParams.get("status") || "";
    const where: any = {};
    if (search) where.OR = [{ firstName: { contains: search } }, { lastName: { contains: search } }, { mobile: { contains: search } }, { employeeCode: { contains: search } }];
    if (department) where.department = department;
    if (status) where.status = status;
    const employees = await prisma.employee.findMany({ where, orderBy: { createdAt: "desc" }, include: { salaryConfig: true } });
    return NextResponse.json(employees);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const count = await prisma.employee.count();
    const code = "EMP" + String(count + 1).padStart(5, "0");
    data.employeeCode = code;
    const employee = await prisma.employee.create({ data });
    return NextResponse.json(employee, { status: 201 });
  } catch (e: any) {
    if (e.code === "P2002") {
      const field = e.meta?.target?.[0] || "field";
      return NextResponse.json({ error: `An employee with this ${field} already exists` }, { status: 409 });
    }
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const all = searchParams.get("all");
    if (all === "true") {
      // Delete related records first (foreign key constraints)
      await prisma.salaryConfig.deleteMany();
      await prisma.faceDetectionLog.deleteMany();
      await prisma.attendanceLog.deleteMany();
      await prisma.leaveRequest.deleteMany();
      await prisma.payrollRecord.deleteMany();
      await prisma.employee.deleteMany();
      return NextResponse.json({ success: true, message: "All employees and related data deleted" });
    }
    return NextResponse.json({ error: "Specify ?all=true to delete all" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
