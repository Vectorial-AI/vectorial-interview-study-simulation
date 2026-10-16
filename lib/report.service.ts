import OpenAI from "openai";
import { Settings } from "@/lib/settings";
import type {
  IndividualResponse,
  IndividualSummary,
  InterviewContextAsset,
  QuestionSummary,
} from "@/lib/types";

export class ReportService {
  private readonly settings = Settings.getInstance();
  private readonly openai = new OpenAI({
    apiKey: Settings.getInstance().openaiApiKey,
  });

  async summarizeQuestion(
    questionId: string,
    question: string,
    contextAssets: InterviewContextAsset[],
    responses: IndividualResponse[]
  ): Promise<QuestionSummary> {
    const rows = responses.map((response) => ({
      profileId: response.profileId,
      profileName: response.profileName,
      answer: response.response,
      reason: response.reason,
      confidence: response.confidence,
    }));
    const result = await this.jsonCompletion<{
      summary?: string;
      themes?: string[];
      consensus?: string[];
      disagreements?: string[];
      notableQuotes?: Array<{
        profileId?: string;
        profileName?: string;
        quote?: string;
      }>;
    }>(
      "Analyze interview responses to one research question. Each response includes the participant's answer, explicit reason, and confidence. Return JSON with summary, themes, consensus, disagreements, and notableQuotes. Base findings on both answers and reasons, weight confidence cautiously rather than treating it as certainty, and preserve minority views. Quotes must be short verbatim excerpts from answers and retain the supplied profileId/profileName. Do not fabricate.",
      JSON.stringify({ question, studyContextAssets: contextAssets, responses: rows }),
      "question_summary",
      QUESTION_SUMMARY_SCHEMA
    );

    return {
      questionId,
      question,
      responseCount: responses.length,
      summary: requiredText(result.summary, "question summary"),
      themes: stringList(result.themes),
      consensus: stringList(result.consensus),
      disagreements: stringList(result.disagreements),
      notableQuotes: (result.notableQuotes ?? [])
        .filter(
          (quote) =>
            typeof quote.profileId === "string" &&
            typeof quote.profileName === "string" &&
            typeof quote.quote === "string"
        )
        .map((quote) => ({
          profileId: quote.profileId!,
          profileName: quote.profileName!,
          quote: quote.quote!,
        })),
    };
  }

  async summarizeProfile(
    profile: {
      profileId: string;
      profileName: string;
      profileSummary: string;
      audienceRoomId: string;
    },
    responses: IndividualResponse[]
  ): Promise<IndividualSummary> {
    const result = await this.jsonCompletion<{
      summary?: string;
      keyViews?: string[];
      needs?: string[];
      concerns?: string[];
    }>(
      "Summarize one interview participant across all questions. Return JSON with summary, keyViews, needs, and concerns. Use the supplied answers and reasons, treat confidence as self-reported rather than objective certainty, and preserve nuance, uncertainty, and contradictions. Do not add unsupported claims.",
      JSON.stringify({
        participant: profile,
        answers: responses.map((response) => ({
          question: response.question,
          answer: response.response,
          reason: response.reason,
          confidence: response.confidence,
        })),
      }),
      "participant_summary",
      PARTICIPANT_SUMMARY_SCHEMA
    );
    return {
      ...profile,
      summary: requiredText(result.summary, "participant summary"),
      keyViews: stringList(result.keyViews),
      needs: stringList(result.needs),
      concerns: stringList(result.concerns),
      responseCount: responses.length,
    };
  }

  async summarizeStudy(input: {
    studyName: string;
    objective?: string;
    questionSummaries: QuestionSummary[];
    requestedProfileCount: number;
    successfulResponseCount: number;
  }): Promise<{
    executiveSummary: string;
    keyFindings: string[];
    sharedNeeds: string[];
    tensions: string[];
    recommendations: string[];
    limitations: string[];
  }> {
    const result = await this.jsonCompletion<{
      executiveSummary?: string;
      keyFindings?: string[];
      sharedNeeds?: string[];
      tensions?: string[];
      recommendations?: string[];
      limitations?: string[];
    }>(
      "Create the final report for an interview study by synthesizing the supplied per-question summaries. Return JSON with executiveSummary, keyFindings, sharedNeeds, tensions, recommendations, and limitations. Treat questionSummaries as the sole qualitative evidence, distinguish evidence from recommendations, include minority views, and do not overgeneralize from this synthetic panel.",
      JSON.stringify(input),
      "study_summary",
      STUDY_SUMMARY_SCHEMA
    );
    return {
      executiveSummary: requiredText(
        result.executiveSummary,
        "study executive summary"
      ),
      keyFindings: stringList(result.keyFindings),
      sharedNeeds: stringList(result.sharedNeeds),
      tensions: stringList(result.tensions),
      recommendations: stringList(result.recommendations),
      limitations: stringList(result.limitations),
    };
  }

  private async jsonCompletion<T>(
    system: string,
    user: string,
    schemaName: string,
    schema: Record<string, unknown>
  ): Promise<T> {
    const completion = await this.openai.chat.completions.create({
      model: this.settings.openaiModel,
      temperature: 0.1,
      max_tokens: 2000,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          strict: true,
          schema,
        },
      },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const message = completion.choices[0]?.message;
    const content = message?.content;
    if (!content) {
      throw new Error(
        `Report summarization returned no content${
          message?.refusal ? `: ${message.refusal}` : ""
        }`
      );
    }
    return JSON.parse(content) as T;
  }
}

const STRING_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string", minLength: 1 },
} as const;

const QUESTION_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1 },
    themes: STRING_ARRAY_SCHEMA,
    consensus: STRING_ARRAY_SCHEMA,
    disagreements: STRING_ARRAY_SCHEMA,
    notableQuotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          profileId: { type: "string", minLength: 1 },
          profileName: { type: "string", minLength: 1 },
          quote: { type: "string", minLength: 1 },
        },
        required: ["profileId", "profileName", "quote"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "summary",
    "themes",
    "consensus",
    "disagreements",
    "notableQuotes",
  ],
  additionalProperties: false,
};

const PARTICIPANT_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    summary: { type: "string", minLength: 1 },
    keyViews: STRING_ARRAY_SCHEMA,
    needs: STRING_ARRAY_SCHEMA,
    concerns: STRING_ARRAY_SCHEMA,
  },
  required: ["summary", "keyViews", "needs", "concerns"],
  additionalProperties: false,
};

const STUDY_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    executiveSummary: { type: "string", minLength: 1 },
    keyFindings: STRING_ARRAY_SCHEMA,
    sharedNeeds: STRING_ARRAY_SCHEMA,
    tensions: STRING_ARRAY_SCHEMA,
    recommendations: STRING_ARRAY_SCHEMA,
    limitations: STRING_ARRAY_SCHEMA,
  },
  required: [
    "executiveSummary",
    "keyFindings",
    "sharedNeeds",
    "tensions",
    "recommendations",
    "limitations",
  ],
  additionalProperties: false,
};

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Report summarization returned no ${field}`);
  }
  return value.trim();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && !!item.trim()
      )
    : [];
}
