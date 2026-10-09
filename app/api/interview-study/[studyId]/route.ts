import { NextRequest, NextResponse } from "next/server";
import { InterviewStudyStore } from "@/lib/interview-study-store";
import type { InterviewStudyReport } from "@/lib/types";

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ studyId: string }> }
) {
  const { studyId } = await params;
  const enterpriseName = request.nextUrl.searchParams.get("enterpriseName");
  if (!enterpriseName?.trim()) {
    return cors(
      NextResponse.json(
        { error: "enterpriseName is required" },
        { status: 400 }
      )
    );
  }

  try {
    const study = await new InterviewStudyStore(
      enterpriseName.trim()
    ).getLatestByStudyId(studyId);
    if (!study) {
      return cors(
        NextResponse.json({ error: "Interview study not found" }, { status: 404 })
      );
    }

    const includeResult =
      request.nextUrl.searchParams.get("includeResult") !== "false";
    let result: InterviewStudyReport | null = null;
    if (includeResult && study.status === "completed" && study.resultDataUrl) {
      const response = await fetch(study.resultDataUrl, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`Stored report could not be loaded: ${response.status}`);
      }
      result = (await response.json()) as InterviewStudyReport;
    }

    return cors(NextResponse.json({ study, result }));
  } catch (error) {
    return cors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      )
    );
  }
}

function cors(response: NextResponse): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}
