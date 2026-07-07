import { NextResponse } from "next/server";
import { readGuide, readJob } from "@/lib/store";

export const runtime = "nodejs";

/** 查詢解析工作狀態;完成時附上完整指南 JSON。 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let job;
  try {
    job = await readJob(id);
  } catch {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  const guide = job.status === "ready" ? await readGuide(id) : null;
  return NextResponse.json({ job, guide });
}
