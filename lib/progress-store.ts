import { createClient } from "redis";

export interface InterviewProgress {
  runId: string;
  currentStep: number;
  stepName: string;
  totalSteps: number;
  totalQuestions: number;
  processedQuestions: number;
  totalProfiles: number;
  processedResponses: number;
  percentage: number;
  lastUpdate: string;
}

let client: ReturnType<typeof createClient> | null = null;

async function redis() {
  if (!client) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error("REDIS_URL environment variable is not set");
    client = createClient({ url });
    client.on("error", (error) => console.error("Redis error", error));
    await client.connect();
  }
  return client;
}

export class ProgressStore {
  async set(id: string, patch: Partial<InterviewProgress>): Promise<void> {
    const store = await redis();
    const key = `interview-progress:${id}`;
    const existingJson = await store.get(key);
    const existing = existingJson
      ? (JSON.parse(existingJson) as InterviewProgress)
      : null;
    const progress: InterviewProgress = {
      runId: id,
      currentStep: 0,
      stepName: "initializing",
      totalSteps: 4,
      totalQuestions: 0,
      processedQuestions: 0,
      totalProfiles: 0,
      processedResponses: 0,
      percentage: 0,
      lastUpdate: new Date().toISOString(),
      ...existing,
      ...patch,
    };
    await store.setEx(key, 86_400, JSON.stringify(progress));
  }

  async alias(workflowRunId: string, trackingId: string): Promise<void> {
    const store = await redis();
    await store.setEx(
      `interview-progress-alias:${workflowRunId}`,
      86_400,
      trackingId
    );
  }

  async get(id: string): Promise<InterviewProgress | null> {
    const store = await redis();
    const direct = await store.get(`interview-progress:${id}`);
    if (direct) return JSON.parse(direct) as InterviewProgress;
    const trackingId = await store.get(`interview-progress-alias:${id}`);
    if (!trackingId) return null;
    const value = await store.get(`interview-progress:${trackingId}`);
    return value ? (JSON.parse(value) as InterviewProgress) : null;
  }
}
