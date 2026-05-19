import { NextRequest, NextResponse } from "next/server";

const AI_BASE = "https://hrms-ai-abv8.onrender.com";

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
    const headers: Record<string, string> = {};
    // Forward content-type for non-formdata requests
    const ct = request.headers.get("content-type");
    if (ct && !ct.includes("multipart/form-data")) {
      headers["content-type"] = ct;
    }

    let body: BodyInit | null = null;
    if (method !== "GET" && method !== "OPTIONS") {
      if (ct && ct.includes("multipart/form-data")) {
        body = request.body;
      } else {
        body = JSON.stringify(await request.json().catch(() => ({})));
      }
    }

    const aiRes = await fetch(url, {
      method,
      headers: { ...headers, accept: "application/json" },
      body,
      signal: AbortSignal.timeout(25000),
    });

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
