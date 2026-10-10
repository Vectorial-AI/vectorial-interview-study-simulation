import OpenAI from "openai";
import { Settings } from "@/lib/settings";
import type {
  IndividualResponse,
  IndividualSummary,
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
      JSON.stringify({ question, responses: rows })
    );

    return {
      questionId,
      question,
      responseCount: responses.length,
      summary: text(result.summary, "No summary available."),
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
      })
    );
    return {
      ...profile,
      summary: text(result.summary, "No summary available."),
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
    individualSummaries: IndividualSummary[];
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
      "Create the final report for an interview study. Return JSON with executiveSummary, keyFindings, sharedNeeds, tensions, recommendations, and limitations. Distinguish evidence from recommendations, include minority views, and do not overgeneralize from this synthetic panel.",
      JSON.stringify(input)
    );
    return {
      executiveSummary: text(
        result.executiveSummary,
        "No executive summary available."
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
    user: string
  ): Promise<T> {
    const completion = await this.openai.chat.completions.create({
      model: this.settings.openaiModel,
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("Report summarization returned no content");
    return JSON.parse(content) as T;
  }
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && !!item.trim()
      )
    : [];
}
