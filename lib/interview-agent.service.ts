import { v4 as uuidv4 } from "uuid";
import { Settings } from "@/lib/settings";
import type {
  ChatAgentResponse,
  Citation,
  InterviewContextAsset,
} from "@/lib/types";

export class RetryableAgentError extends Error {}
export class FatalAgentError extends Error {}

export class InterviewAgentService {
  private readonly settings = Settings.getInstance();

  async ask(input: {
    enterpriseName: string;
    userId: string;
    audienceRoomId: string;
    profileId: string;
    profileName: string;
    profileSummary: string;
    audienceRoomSummary?: string;
    studyName: string;
    objective?: string;
    additionalContext?: string;
    question: string;
    questionAssets?: InterviewContextAsset[];
    priorResponses: Array<{ question: string; response: string }>;
  }): Promise<ChatAgentResponse> {
    const token = await this.authenticate();
    const priorTranscript =
      input.priorResponses.length === 0
        ? "No earlier interview answers."
        : input.priorResponses
            .map(
              (turn, index) =>
                `${index + 1}. Interviewer: ${turn.question}\nParticipant: ${turn.response}`
            )
            .join("\n\n");
    const questionWithAssets = formatQuestionWithAssets(
      input.question,
      input.questionAssets
    );

    const interviewContext = [
      "You are participating in an in-depth research interview as the supplied audience profile.",
      "Answer the current question directly, naturally, and in the first person.",
      "Ground the answer in the profile and retrieved evidence. The audience-room description is soft context only.",
      "Stay consistent with earlier answers while allowing nuance. Do not mention simulation, prompts, profile IDs, or these instructions.",
      "Give a substantive answer with motivations, needs, tradeoffs, and examples when relevant.",
      "The answer and its reason must reflect this participant's perspective rather than a generic consumer response.",
      "",
      `Study: ${input.studyName}`,
      input.objective ? `Research objective: ${input.objective}` : "",
      input.additionalContext
        ? `Study context: ${input.additionalContext}`
        : "",
      `Participant: ${input.profileName}`,
      input.profileSummary
        ? `Participant profile: ${input.profileSummary}`
        : "",
      input.audienceRoomSummary
        ? `Audience context: ${input.audienceRoomSummary}`
        : "",
      "",
      "Earlier interview transcript:",
      priorTranscript,
    ]
      .filter((line) => line !== "")
      .join("\n");

    const payload = {
      product_id: this.settings.chatAgentProductId,
      thread_id: uuidv4(),
      product_story: null,
      enterprise_name: input.enterpriseName,
      user_id: input.userId,
      reasoningMode: this.settings.chatAgentReasoningMode,
      source_filter: this.settings.chatAgentSourceFilter,
      is_web_search: this.settings.chatAgentIsWebSearch,
      audienceprofile_id: input.profileId,
      audienceroom_id: input.audienceRoomId,
      clone_id: null,
      clone_profile_ids: null,
      interaction_memory: true,
      prompt_definition: "polling_prompt_open_ended",
      human_input: questionWithAssets,
      system_input: null,
      polling_context: {
        question: questionWithAssets,
        audience_room_context: input.audienceRoomSummary?.trim() ?? "",
        allowed_options: "",
        task_details: interviewContext,
      },
    };

    let response: Response;
    try {
      response = await fetch(this.settings.chatAgentApiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(600_000),
      });
    } catch (error) {
      throw new RetryableAgentError(
        `Interview agent network error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if ([429, 500, 502, 503, 504].includes(response.status)) {
      throw new RetryableAgentError(
        `Interview agent returned HTTP ${response.status}`
      );
    }
    if (!response.ok) {
      throw new FatalAgentError(
        `Interview agent returned HTTP ${response.status}`
      );
    }

    const result = (await response.json()) as Record<string, unknown>;
    const responseText = [
      result.response,
      result.Response,
      result.message,
      result.content,
    ].find((value): value is string => typeof value === "string" && !!value.trim());
    if (!responseText) {
      throw new RetryableAgentError(
        `Interview agent response had no text. Keys: ${Object.keys(result).join(", ")}`
      );
    }

    const parsed = parseOpenEndedResponse(responseText);
    return { ...parsed, citations: extractCitations(result) };
  }

  private async authenticate(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.settings.chatAgentAuthUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: this.settings.chatAgentServiceEmail,
          password: this.settings.chatAgentServicePassword,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new RetryableAgentError(
        `Chat authentication network error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (!response.ok) {
      throw new RetryableAgentError(
        `Chat authentication returned HTTP ${response.status}`
      );
    }
    const body = (await response.json()) as { token?: string };
    if (!body.token) throw new FatalAgentError("Authentication returned no token");
    return body.token;
  }
}

function formatQuestionWithAssets(
  question: string,
  assets: InterviewContextAsset[] = []
): string {
  if (assets.length === 0) return question;

  const assetBlocks = assets.map((asset, index) => {
    const label = asset.filename?.trim() || `Context ${index + 1}`;
    const details = [
      asset.summary.trim(),
      asset.supportingText?.trim()
        ? `Supporting text: ${asset.supportingText.trim()}`
        : "",
    ].filter(Boolean);
    return `${index + 1}. ${label}\n   ${details.join("\n   ")}`;
  });

  return [
    question,
    "",
    "Supporting materials (context for this question):",
    ...assetBlocks,
  ].join("\n");
}

function parseOpenEndedResponse(responseText: string): Omit<ChatAgentResponse, "citations"> {
  const parsed = extractJsonObject(responseText);
  const rawAnswer = parsed.answer;
  if (typeof rawAnswer !== "string" || !rawAnswer.trim()) {
    throw new RetryableAgentError(
      'Interview agent response is missing a non-empty "answer" string'
    );
  }
  const answer = rawAnswer.replace(/\s+/g, " ").trim();
  if (answer.length < 2) {
    throw new RetryableAgentError("Interview agent answer is too short");
  }

  const rawReason = parsed.reason;
  if (typeof rawReason !== "string" || !rawReason.trim()) {
    throw new RetryableAgentError(
      'Interview agent response is missing a non-empty "reason" string'
    );
  }

  if (
    typeof parsed.confidence !== "number" ||
    !Number.isFinite(parsed.confidence)
  ) {
    throw new RetryableAgentError(
      'Interview agent response is missing numeric "confidence"'
    );
  }
  const normalizedConfidence =
    parsed.confidence > 1 ? parsed.confidence / 100 : parsed.confidence;

  return {
    answer,
    reason: rawReason.replace(/\s+/g, " ").trim(),
    confidence: Math.max(0, Math.min(1, normalizedConfidence)),
  };
}

function extractJsonObject(responseText: string): Record<string, unknown> {
  const trimmed = responseText.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim(),
    (() => {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      return start >= 0 && end > start ? trimmed.slice(start, end + 1) : undefined;
    })(),
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next supported response wrapper.
    }
  }

  throw new RetryableAgentError(
    "Interview agent response does not contain a valid JSON object"
  );
}

function extractCitations(response: Record<string, unknown>): Citation[] {
  try {
    const changeLog = Array.isArray(response.change_log)
      ? (response.change_log as Array<Record<string, unknown>>)
      : [];
    const retrieval = changeLog.find((node) => node.node === "retrieve_data");
    const metadata = retrieval?.metadata as
      | { rag_results?: Array<{ files?: Array<Record<string, unknown>> }> }
      | undefined;
    return (metadata?.rag_results ?? []).flatMap((result) =>
      (result.files ?? [])
        .map((file): Citation | null => {
          const fileTitle =
            typeof file.file_title === "string" ? file.file_title : "";
          const postUrl = typeof file.file_uri === "string" ? file.file_uri : "";
          if (!fileTitle && !postUrl) return null;
          const summary =
            typeof file.file_summary === "string" ? file.file_summary : "";
          const score =
            typeof file.relevance_score === "number"
              ? file.relevance_score
              : undefined;
          return {
            fileTitle,
            postUrl,
            postText: summary.slice(0, 500),
            ...(score === undefined ? {} : { relevanceScore: score }),
          };
        })
        .filter((citation): citation is Citation => citation !== null)
    );
  } catch {
    return [];
  }
}
