import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() { const data = await prisma.leaveType.findMany(); return NextResponse.json(data); }
export async function POST(req: NextRequest) { try { const data = await req.json(); const lt = await prisma.leaveType.create({ data }); return NextResponse.json(lt, { status: 201 }); } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); } }
