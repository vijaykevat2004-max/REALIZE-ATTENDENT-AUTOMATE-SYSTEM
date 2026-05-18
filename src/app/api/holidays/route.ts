import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() { const data = await prisma.holiday.findMany({ orderBy: { date: "asc" } }); return NextResponse.json(data); }
export async function POST(req: NextRequest) { try { const data = await req.json(); const h = await prisma.holiday.create({ data }); return NextResponse.json(h, { status: 201 }); } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); } }
