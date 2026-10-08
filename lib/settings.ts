export class Settings {
  private static instance: Settings | null = null;

  static getInstance(): Settings {
    if (!Settings.instance) Settings.instance = new Settings();
    return Settings.instance;
  }

  readonly chatAgentServiceEmail = required("CHAT_AGENT_SERVICE_EMAIL");
  readonly chatAgentServicePassword = required("CHAT_AGENT_SERVICE_PASSWORD");
  readonly chatAgentAuthUrl =
    process.env.CHAT_AGENT_AUTH_URL ??
    "https://auth-api.vectorialapi.com/api/auth/login";
  readonly chatAgentApiUrl =
    process.env.CHAT_AGENT_API_URL ??
    "https://chat-api.vectorialapi.com/agent/langgraphV3/";
  readonly chatAgentProductId =
    process.env.CHAT_AGENT_PRODUCT_ID ??
    "3d443c79-fb7c-45b0-977d-ac1901960711";
  readonly chatAgentReasoningMode =
    process.env.CHAT_AGENT_REASONING_MODE !== "false";
  readonly chatAgentIsWebSearch =
    process.env.CHAT_AGENT_IS_WEB_SEARCH === "true";
  readonly chatAgentSourceFilter = (
    process.env.CHAT_AGENT_SOURCE_FILTER ??
    "Slack,Salesforce,Coda,Dialpad,Google Drive,Manual_Upload,socials"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  readonly profileEnrichmentApiBaseUrl =
    process.env.PROFILE_ENRICHMENT_API_BASE_URL ??
    "https://audience-management.vercel.app/api/v1";
  readonly profileDescriptionApiBaseUrl =
    process.env.PROFILE_DESCRIPTION_API_BASE_URL ??
    "https://audience-workflow.vercel.app/api/v1";
  readonly openaiApiKey = required("OPENAI_API_KEY");
  readonly openaiModel = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  readonly responseBatchSize = positiveInteger(
    process.env.INTERVIEW_RESPONSE_BATCH_SIZE ??
      process.env.SURVEY_BATCH_SIZE ??
      process.env.CHAT_BATCH_SIZE,
    2
  );
}

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
