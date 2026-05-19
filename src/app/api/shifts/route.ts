import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export async function GET() { try { const data = await prisma.shift.findMany({ orderBy: { name: "asc" } }); return NextResponse.json(data); } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); } }
export async function POST(req: NextRequest) { try { const data = await req.json(); const s = await prisma.shift.create({ data }); return NextResponse.json(s, { status: 201 }); } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); } }
