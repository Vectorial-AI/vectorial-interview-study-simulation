export interface AudienceRoomInput {
  id: string;
  maxProfiles: number;
}

export interface InterviewQuestionInput {
  id: string;
  text: string;
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
  citations: Citation[];
  error?: string;
}

export interface QuestionSummary {
  questionId: string;
  question: string;
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

export type InterviewStudyWorkflowOutput =
  | { status: "completed"; result: InterviewStudyReport }
  | { status: "failed"; error: string };

export interface ChatAgentResponse {
  responseText: string;
  citations: Citation[];
}
