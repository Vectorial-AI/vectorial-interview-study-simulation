import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { interviewStudyWorkflow } from "@/app/workflows/interview-study";
import { InterviewStudyStore } from "@/lib/interview-study-store";
import { ProgressStore } from "@/lib/progress-store";
import { Settings } from "@/lib/settings";
import type {
  AudienceRoomInput,
  InterviewContextAsset,
  InterviewQuestionInput,
  InterviewStudyInput,
  InterviewStudyStatus,
} from "@/lib/types";

const MAX_QUESTION_ASSETS = 3;

export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 204 }));
}

export async function GET(request: NextRequest) {
  try {
    const enterpriseName = requiredString(
      request.nextUrl.searchParams.get("enterpriseName"),
      "enterpriseName"
    );
    const userId = optionalString(request.nextUrl.searchParams.get("userId"));
    const studyId = optionalString(request.nextUrl.searchParams.get("studyId"));
    const status = optionalStatus(request.nextUrl.searchParams.get("status"));
    const limit = boundedInteger(
      request.nextUrl.searchParams.get("limit"),
      25,
      1,
      100,
      "limit"
    );
    const offset = boundedInteger(
      request.nextUrl.searchParams.get("offset"),
      0,
      0,
      10_000,
      "offset"
    );
    const result = await new InterviewStudyStore(enterpriseName).list({
      userId,
      studyId,
      status,
      limit,
      offset,
    });

    return cors(
      NextResponse.json({
        ...result,
        limit,
        offset,
        hasMore: offset + result.studies.length < result.total,
      })
    );
  } catch (error) {
    return cors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 }
      )
    );
  }
}

export async function POST(request: NextRequest) {
  let store: InterviewStudyStore | null = null;
  let recordId: string | null = null;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const parsed = validate(body);
    const trackingId = randomUUID();
    const studyId = parsed.studyId ?? randomUUID();
    const settings = Settings.getInstance();
    const input: InterviewStudyInput = {
      ...parsed,
      studyId,
      runId: trackingId,
      responseBatchSize: settings.responseBatchSize,
    };
    store = new InterviewStudyStore(input.enterpriseName);
    recordId = trackingId;
    await store.create({
      id: recordId,
      studyId,
      runId: trackingId,
      studyName: input.studyName,
      objective: input.objective,
      additionalContext: input.additionalContext,
      questions: input.questions,
      audienceRooms: input.audienceRooms,
      enterpriseName: input.enterpriseName,
      userId: input.userId,
      userEmail: input.userEmail,
    });

    const progress = new ProgressStore();
    await progress.set(trackingId, {
      totalQuestions: input.questions.length,
      stepName: "queued",
    });
    const run = await start(interviewStudyWorkflow, [input]);
    await Promise.all([
      progress.alias(run.runId, trackingId),
      store.setWorkflowRunId(recordId, run.runId),
    ]);

    return cors(
      NextResponse.json(
        {
          runId: run.runId,
          studyId,
          status: "queued",
          statusUrl: `/api/interview-study/status/${run.runId}?enterpriseName=${encodeURIComponent(input.enterpriseName)}`,
          resultUrl: `/api/interview-study/${encodeURIComponent(studyId)}?enterpriseName=${encodeURIComponent(input.enterpriseName)}`,
        },
        { status: 202 }
      )
    );
  } catch (error) {
    if (store && recordId) {
      try {
        await store.markFailed(
          recordId,
          error instanceof Error ? error.message : String(error)
        );
      } catch {
        // Preserve the startup error.
      }
    }
    return cors(
      NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 400 }
      )
    );
  }
}

function validate(body: Record<string, unknown>): Omit<
  InterviewStudyInput,
  "runId" | "studyId" | "responseBatchSize"
> & { studyId?: string } {
  const studyName = requiredString(body.studyName, "studyName");
  const enterpriseName = requiredString(body.enterpriseName, "enterpriseName");
  const userId = requiredString(body.userId, "userId");
  const rawQuestions = body.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error("questions must be a non-empty array");
  }
  if (rawQuestions.length > 50) {
    throw new Error("questions may contain at most 50 items");
  }
  const questions: InterviewQuestionInput[] = rawQuestions.map(
    (question, index) => {
      if (typeof question === "string") {
        return {
          id: `question-${index + 1}`,
          text: requiredString(question, `questions[${index}]`),
        };
      }
      if (!question || typeof question !== "object") {
        throw new Error(`questions[${index}] must be a string or object`);
      }
      const value = question as Record<string, unknown>;
      return {
        id:
          optionalString(value.id) ??
          `question-${index + 1}`,
        text: requiredString(value.text, `questions[${index}].text`),
        questionAssets: parseQuestionAssets(
          value.questionAssets,
          `questions[${index}].questionAssets`
        ),
      };
    }
  );
  if (new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new Error("question IDs must be unique");
  }

  if (!Array.isArray(body.audienceRooms) || body.audienceRooms.length === 0) {
    throw new Error("audienceRooms must be a non-empty array");
  }
  if (body.audienceRooms.length > 10) {
    throw new Error("audienceRooms may contain at most 10 rooms");
  }
  const audienceRooms: AudienceRoomInput[] = body.audienceRooms.map(
    (room, index) => {
      if (!room || typeof room !== "object") {
        throw new Error(`audienceRooms[${index}] must be an object`);
      }
      const value = room as Record<string, unknown>;
      const maxProfiles =
        value.maxProfiles === undefined ? 25 : Number(value.maxProfiles);
      if (
        !Number.isInteger(maxProfiles) ||
        maxProfiles < 1 ||
        maxProfiles > 100
      ) {
        throw new Error(
          `audienceRooms[${index}].maxProfiles must be an integer from 1 to 100`
        );
      }
      return {
        id: requiredString(value.id, `audienceRooms[${index}].id`),
        maxProfiles,
      };
    }
  );
  if (
    new Set(audienceRooms.map((room) => room.id)).size !==
    audienceRooms.length
  ) {
    throw new Error("audience room IDs must be unique");
  }
  const requestedProfiles = audienceRooms.reduce(
    (total, room) => total + room.maxProfiles,
    0
  );
  if (requestedProfiles > 100) {
    throw new Error("A study may request at most 100 profiles in total");
  }

  return {
    studyId: optionalString(body.studyId),
    studyName,
    objective: optionalString(body.objective),
    additionalContext: optionalString(body.additionalContext),
    questions,
    audienceRooms,
    enterpriseName,
    userId,
    userEmail: optionalString(body.userEmail),
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseQuestionAssets(
  value: unknown,
  field: string
): InterviewContextAsset[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array`);
  }
  if (value.length > MAX_QUESTION_ASSETS) {
    throw new Error(
      `${field} may contain at most ${MAX_QUESTION_ASSETS} assets`
    );
  }

  const assets = value.map((asset, index): InterviewContextAsset => {
    const assetField = `${field}[${index}]`;
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
      throw new Error(`${assetField} must be an object`);
    }
    const raw = asset as Record<string, unknown>;
    const rawContentType = optionalStringField(
      raw.contentType,
      `${assetField}.contentType`
    );
    if (
      rawContentType !== undefined &&
      rawContentType !== "image" &&
      rawContentType !== "document"
    ) {
      throw new Error(
        `${assetField}.contentType must be image or document`
      );
    }
    const contentType: InterviewContextAsset["contentType"] = rawContentType;

    return {
      summary: requiredString(raw.summary, `${assetField}.summary`),
      ...optionalProperty(
        "supportingText",
        optionalStringField(raw.supportingText, `${assetField}.supportingText`)
      ),
      ...optionalProperty("contentType", contentType),
      ...optionalProperty(
        "mimeType",
        optionalStringField(raw.mimeType, `${assetField}.mimeType`)
      ),
      ...optionalProperty(
        "url",
        optionalStringField(raw.url, `${assetField}.url`)
      ),
      ...optionalProperty(
        "filename",
        optionalStringField(raw.filename, `${assetField}.filename`)
      ),
    };
  });

  return assets.length > 0 ? assets : undefined;
}

function optionalStringField(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string when provided`);
  }
  return value.trim() || undefined;
}

function optionalProperty<K extends string, V>(
  key: K,
  value: V | undefined
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function optionalStatus(value: unknown): InterviewStudyStatus | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error("status must be queued, running, completed, or failed");
}

function boundedInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
  field: string
): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer from ${min} through ${max}`);
  }
  return parsed;
}

function cors(response: NextResponse): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}
