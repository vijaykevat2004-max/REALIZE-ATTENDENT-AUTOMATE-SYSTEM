import { NextRequest, NextResponse } from "next/server";

// Use environment variable for AI service URL, fallback to Render
const AI_BASE = process.env.AI_SERVICE_URL || "https://hrms-ai-abv8.onrender.com";

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path, "GET");
}

export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path, "POST");
}

export async function OPTIONS(request: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(request, params.path, "OPTIONS");
}

async function proxy(request: NextRequest, path: string[], method: string) {
  const pathStr = path.join("/");
  const url = `${AI_BASE}/${pathStr}`;

  try {
    const ct = request.headers.get("content-type") || "";
    const isForm = ct.includes("multipart/form-data");

    const headers: Record<string, string> = { "content-type": ct };

    let body: BodyInit | null = null;
    if (method !== "GET" && method !== "OPTIONS") {
      if (isForm) {
        body = request.body;
      } else {
        body = await request.text();
      }
    }

    const fetchOpts: RequestInit & { duplex?: string } = {
      method,
      headers: { ...headers, accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    };
    if (body) {
      fetchOpts.body = body;
      fetchOpts.duplex = "half";
    }
    const aiRes = await fetch(url, fetchOpts);

    const aiBody = await aiRes.text();
    return new NextResponse(aiBody, {
      status: aiRes.status,
      headers: {
        "Content-Type": aiRes.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Proxy failed" },
      { status: 502 }
    );
  }
}
