export interface AudienceRoomInput {
  id: string;
  maxProfiles: number;
}

export interface InterviewContextAsset {
  summary: string;
  supportingText?: string;
  contentType?: "image" | "document";
  mimeType?: string;
  url?: string;
  filename?: string;
}

export interface InterviewQuestionInput {
  id: string;
  text: string;
  /** Supporting material for this question; not an answer option. */
  questionAssets?: InterviewContextAsset[];
}

export interface InterviewStudyInput {
  runId: string;
  studyId: string;
  studyName: string;
  objective?: string;
  additionalContext?: string;
  questions: InterviewQuestionInput[];
  audienceRooms: AudienceRoomInput[];
  enterpriseName: string;
  userId: string;
  userEmail?: string;
  responseBatchSize: number;
}

export interface AudienceProfile {
  profileId: string;
  name: string;
  profileSummary: string;
}

export interface RoomProfiles {
  audienceRoomId: string;
  audienceRoomSummary?: string;
  profiles: AudienceProfile[];
}

export interface Citation {
  fileTitle: string;
  postText: string;
  postUrl: string;
  relevanceScore?: number;
}

export interface IndividualResponse {
  questionId: string;
  question: string;
  questionIndex: number;
  profileId: string;
  profileName: string;
  profileSummary: string;
  audienceRoomId: string;
  response: string;
  reason: string;
  confidence: number;
  citations: Citation[];
  error?: string;
}

export interface QuestionSummary {
  questionId: string;
  question: string;
  questionAssets: InterviewContextAsset[];
  responseCount: number;
  summary: string;
  themes: string[];
  consensus: string[];
  disagreements: string[];
  notableQuotes: Array<{
    profileId: string;
    profileName: string;
    quote: string;
  }>;
}

export interface IndividualSummary {
  profileId: string;
  profileName: string;
  profileSummary: string;
  audienceRoomId: string;
  summary: string;
  keyViews: string[];
  needs: string[];
  concerns: string[];
  responseCount: number;
}

export interface InterviewStudyReport {
  studyId: string;
  studyName: string;
  objective?: string;
  questions: InterviewQuestionInput[];
  audienceRoomIds: string[];
  questionCount: number;
  profileCount: number;
  responseCount: number;
  completedAt: string;
  overallSummary: {
    executiveSummary: string;
    keyFindings: string[];
    sharedNeeds: string[];
    tensions: string[];
    recommendations: string[];
    limitations: string[];
  };
  questionSummaries: QuestionSummary[];
  individualSummaries: IndividualSummary[];
  individualResponses: IndividualResponse[];
  resultDataUrl?: string;
}

export type InterviewStudyStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface InterviewStudyRecord {
  id: string;
  studyId: string;
  runId: string | null;
  studyName: string;
  objective: string | null;
  additionalContext: string | null;
  questions: InterviewQuestionInput[];
  audienceRooms: AudienceRoomInput[];
  enterpriseName: string;
  userId: string;
  userEmail: string | null;
  status: InterviewStudyStatus;
  resultDataUrl: string | null;
  error: string | null;
  questionCount: number;
  profileCount: number | null;
  responseCount: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type InterviewStudyWorkflowOutput =
  | { status: "completed"; result: InterviewStudyReport }
  | { status: "failed"; error: string };

export interface ChatAgentResponse {
  answer: string;
  reason: string;
  confidence: number;
  citations: Citation[];
}
