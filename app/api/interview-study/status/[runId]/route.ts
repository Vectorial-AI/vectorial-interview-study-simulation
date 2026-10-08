import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { ProgressStore } from "@/lib/progress-store";
import type { InterviewStudyWorkflowOutput } from "@/lib/types";

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET(
  _request: Request,
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
