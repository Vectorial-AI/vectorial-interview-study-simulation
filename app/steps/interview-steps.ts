import { put } from "@vercel/blob";
import { RetryableError, getStepMetadata } from "workflow";
import {
  FatalAgentError,
  InterviewAgentService,
  RetryableAgentError,
} from "@/lib/interview-agent.service";
import { ProfileService } from "@/lib/profile.service";
import { ProgressStore } from "@/lib/progress-store";
import { ReportService } from "@/lib/report.service";
import type {
  IndividualResponse,
  IndividualSummary,
  InterviewStudyReport,
  QuestionSummary,
  RoomProfiles,
} from "@/lib/types";

export async function fetchRoomProfilesStep(
  audienceRoomId: string,
  maxProfiles: number,
  enterpriseName: string
): Promise<RoomProfiles> {
  "use step";
  return new ProfileService().fetchRoom(
    audienceRoomId,
    maxProfiles,
    enterpriseName
  );
}

export async function askInterviewQuestionStep(input: {
  enterpriseName: string;
  userId: string;
  studyName: string;
  objective?: string;
  additionalContext?: string;
  questionId: string;
  question: string;
  questionIndex: number;
  audienceRoomId: string;
  audienceRoomSummary?: string;
  profileId: string;
  profileName: string;
  profileSummary: string;
  priorResponses: Array<{ question: string; response: string }>;
}): Promise<IndividualResponse> {
  "use step";
  try {
    const result = await new InterviewAgentService().ask(input);
    return {
      questionId: input.questionId,
      question: input.question,
      questionIndex: input.questionIndex,
      profileId: input.profileId,
      profileName: input.profileName,
      profileSummary: input.profileSummary,
      audienceRoomId: input.audienceRoomId,
      response: result.responseText,
      citations: result.citations,
    };
  } catch (error) {
    if (error instanceof RetryableAgentError) {
      const attempt = getStepMetadata().attempt;
      throw new RetryableError(error.message, {
        retryAfter: Math.min(30_000 * 2 ** attempt, 120_000),
      });
    }
    if (error instanceof FatalAgentError) {
      // Preserve a failed participant response in the report without failing
      // every other interview in the study.
      return {
        questionId: input.questionId,
        question: input.question,
        questionIndex: input.questionIndex,
        profileId: input.profileId,
        profileName: input.profileName,
        profileSummary: input.profileSummary,
        audienceRoomId: input.audienceRoomId,
        response: "",
        citations: [],
        error: error.message,
      };
    }
    throw error;
  }
}
askInterviewQuestionStep.maxRetries = 6;

export async function summarizeQuestionStep(
  questionId: string,
  question: string,
  responses: IndividualResponse[]
): Promise<QuestionSummary> {
  "use step";
  return new ReportService().summarizeQuestion(
    questionId,
    question,
    responses.filter((response) => !response.error && !!response.response)
  );
}

export async function summarizeProfileStep(
  profile: {
    profileId: string;
    profileName: string;
    profileSummary: string;
    audienceRoomId: string;
  },
  responses: IndividualResponse[]
): Promise<IndividualSummary> {
  "use step";
  return new ReportService().summarizeProfile(
    profile,
    responses.filter((response) => !response.error && !!response.response)
  );
}

export async function summarizeStudyStep(input: {
  studyName: string;
  objective?: string;
  questionSummaries: QuestionSummary[];
  individualSummaries: IndividualSummary[];
  requestedProfileCount: number;
  successfulResponseCount: number;
}): Promise<InterviewStudyReport["overallSummary"]> {
  "use step";
  return new ReportService().summarizeStudy(input);
}

export async function storeReportStep(
  enterpriseName: string,
  report: InterviewStudyReport
): Promise<string> {
  "use step";
  const safeEnterprise = enterpriseName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeStudyId = report.studyId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const blob = await put(
    `interview-studies/${safeEnterprise}/${safeStudyId}.json`,
    JSON.stringify(report, null, 2),
    { access: "public", contentType: "application/json", addRandomSuffix: false }
  );
  return blob.url;
}

export async function getCompletionTimestampStep(): Promise<string> {
  "use step";
  return new Date().toISOString();
}

export async function updateProgressStep(
  runId: string,
  patch: Parameters<ProgressStore["set"]>[1]
): Promise<void> {
  "use step";
  await new ProgressStore().set(runId, patch);
}
updateProgressStep.maxRetries = 0;
