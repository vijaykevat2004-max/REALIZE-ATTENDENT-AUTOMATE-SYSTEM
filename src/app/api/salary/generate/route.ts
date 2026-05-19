import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const month = searchParams.get("month") ? parseInt(searchParams.get("month")) : new Date().getMonth() + 1;
    const year = searchParams.get("year") ? parseInt(searchParams.get("year")) : new Date().getFullYear();
    const data = await prisma.payrollRecord.findMany({
      where: { month, year },
      include: { employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true, department: true } } },
      orderBy: { employee: { firstName: "asc" } },
    });
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
export async function POST(req: NextRequest) {
  try {
    const { month, year } = await req.json();
    const employees = await prisma.employee.findMany({ where: { status: "ACTIVE" }, include: { salaryConfig: true } });
    const results = [];
    for (const emp of employees) {
      const config = emp.salaryConfig || await prisma.salaryConfig.upsert({
        where: { employeeId: emp.id }, update: {}, create: { employeeId: emp.id, basic: 0, hra: 0, da: 0, conveyance: 0, medical: 0, specialAllowance: 0, bonus: 0, otherAllowance: 0, pf: 0, pfPercent: 12, esi: 0, tds: 0, professionalTax: 200, loanDeduction: 0, otherDeduction: 0, overtimeRate: 0, effectiveFrom: emp.joinDate },
      });
      const basic = config.basic || 0; const hra = config.hra || 0; const da = config.da || 0;
      const conveyance = config.conveyance || 0; const medical = config.medical || 0;
      const specialAllowance = config.specialAllowance || 0; const bonus = config.bonus || 0;
      const otherAllowance = config.otherAllowance || 0;
      const grossPrice = basic + hra + da + conveyance + medical + specialAllowance + bonus + otherAllowance;
      const pfAmt = grossPrice * (config.pfPercent || 12) / 100;
      const tds = config.tds || 0; const profTax = config.professionalTax || 200;
      const totalDed = pfAmt + tds + profTax + (config.esi || 0) + (config.loanDeduction || 0) + (config.otherDeduction || 0);
      const net = Math.max(0, grossPrice - totalDed);
      const payroll = await prisma.payrollRecord.upsert({
        where: { employeeId_month_year: { employeeId: emp.id, month, year } },
        update: { basic, hra, da, conveyance, medical, specialAllowance, bonus, otherAllowance, grossSalary: grossPrice, pf: pfAmt, tds, professionalTax: profTax, totalDeductions: totalDed, netSalary: net, status: "GENERATED", generatedAt: new Date().toISOString().split("T")[0] },
        create: { employeeId: emp.id, month, year, basic, hra, da, conveyance, medical, specialAllowance, bonus, otherAllowance, grossSalary: grossPrice, pf: pfAmt, tds, professionalTax: profTax, totalDeductions: totalDed, netSalary: net, status: "GENERATED", generatedAt: new Date().toISOString().split("T")[0] },
      });
      results.push(payroll);
    }
    return NextResponse.json({ success: true, count: results.length });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
