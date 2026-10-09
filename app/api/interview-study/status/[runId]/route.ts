import { NextRequest, NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { InterviewStudyStore } from "@/lib/interview-study-store";
import { ProgressStore } from "@/lib/progress-store";
import type {
  InterviewStudyReport,
  InterviewStudyWorkflowOutput,
} from "@/lib/types";

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  try {
    const run = getRun(runId);
    const status = await run.status;
    const progress = await new ProgressStore().get(runId);

    if (status === "completed") {
      const output = (await run.returnValue) as
        | InterviewStudyWorkflowOutput
        | undefined;
      if (output?.status === "failed") {
        return cors(
          NextResponse.json({
            runId,
            status: "failed",
            progress,
            result: null,
            error: output.error,
          })
        );
      }
      return cors(
        NextResponse.json({
          runId,
          status: "completed",
          progress,
          result: output?.status === "completed" ? output.result : null,
          error: null,
        })
      );
    }

    if (status === "failed") {
      return cors(
        NextResponse.json({
          runId,
          status: "failed",
          progress,
          result: null,
          error: "Workflow execution failed",
        })
      );
    }

    return cors(
      NextResponse.json({
        runId,
        status: "running",
        progress,
        result: null,
        error: null,
      })
    );
  } catch {
    const enterpriseName = request.nextUrl.searchParams.get("enterpriseName");
    if (enterpriseName?.trim()) {
      try {
        const study = await new InterviewStudyStore(
          enterpriseName.trim()
        ).getByRunId(runId);
        if (study) {
          let result: InterviewStudyReport | null = null;
          if (study.status === "completed" && study.resultDataUrl) {
            const response = await fetch(study.resultDataUrl, {
              signal: AbortSignal.timeout(30_000),
            });
            if (response.ok) {
              result = (await response.json()) as InterviewStudyReport;
            }
          }
          return cors(
            NextResponse.json({
              runId,
              studyId: study.studyId,
              status: study.status,
              progress: null,
              result,
              resultDataUrl: study.resultDataUrl,
              error: study.error,
            })
          );
        }
      } catch {
        return cors(
          NextResponse.json(
            { runId, error: "Persisted workflow status could not be loaded" },
            { status: 500 }
          )
        );
      }
    }
    return cors(
      NextResponse.json(
        { runId, error: "Workflow run not found" },
        { status: 404 }
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
