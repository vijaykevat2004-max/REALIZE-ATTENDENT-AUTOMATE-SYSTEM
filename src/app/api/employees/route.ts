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
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
