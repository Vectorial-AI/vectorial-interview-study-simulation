import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { Settings } from "@/lib/settings";
import type {
  AudienceRoomInput,
  InterviewQuestionInput,
  InterviewStudyRecord,
  InterviewStudyReport,
  InterviewStudyStatus,
} from "@/lib/types";

interface CreateStudyRecord {
  id: string;
  studyId: string;
  runId: string;
  studyName: string;
  objective?: string;
  additionalContext?: string;
  questions: InterviewQuestionInput[];
  audienceRooms: AudienceRoomInput[];
  enterpriseName: string;
  userId: string;
  userEmail?: string;
}

interface ListStudiesOptions {
  userId?: string;
  status?: InterviewStudyStatus;
  studyId?: string;
  limit: number;
  offset: number;
}

interface StudyRow extends QueryResultRow {
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
  resultData: string | null;
  error: string | null;
  questionCount: number;
  profileCount: number | null;
  responseCount: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt: Date | string | null;
}

const pools = new Map<string, Pool>();
const schemaReady = new Map<string, Promise<void>>();

export class InterviewStudyStore {
  private readonly pool: Pool;
  private readonly databaseUrl: string;

  constructor(private readonly enterpriseName: string) {
    this.databaseUrl = Settings.getInstance().getEnterpriseDirectDatabaseUrl(
      enterpriseName
    );
    let pool = pools.get(this.databaseUrl);
    if (!pool) {
      pool = new Pool({
        connectionString: this.databaseUrl,
        max: 3,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      });
      pools.set(this.databaseUrl, pool);
    }
    this.pool = pool;
  }

  async create(input: CreateStudyRecord): Promise<InterviewStudyRecord> {
    await this.ensureSchema();
    const result = await this.pool.query<StudyRow>(
      `INSERT INTO "InterviewStudyResult" (
        "id", "studyId", "runId", "studyName", "objective",
        "additionalContext", "questions", "audienceRooms", "enterpriseName",
        "userId", "userEmail", "status", "questionCount"
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7::jsonb, $8::jsonb, $9,
        $10, $11, 'queued', $12
      )
      RETURNING *`,
      [
        input.id,
        input.studyId,
        input.runId,
        input.studyName,
        input.objective ?? null,
        input.additionalContext ?? null,
        JSON.stringify(input.questions),
        JSON.stringify(input.audienceRooms),
        input.enterpriseName,
        input.userId,
        input.userEmail ?? null,
        input.questions.length,
      ]
    );
    return mapRow(result.rows[0]);
  }

  async setWorkflowRunId(id: string, runId: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `UPDATE "InterviewStudyResult"
       SET "runId" = $2, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      [id, runId]
    );
  }

  async markRunning(id: string): Promise<void> {
    await this.updateStatus(id, "running");
  }

  async markCompleted(
    id: string,
    report: InterviewStudyReport,
    resultDataUrl: string
  ): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `UPDATE "InterviewStudyResult"
       SET "status" = 'completed',
           "resultData" = $2,
           "error" = NULL,
           "profileCount" = $3,
           "responseCount" = $4,
           "completedAt" = $5,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      [
        id,
        resultDataUrl,
        report.profileCount,
        report.responseCount,
        report.completedAt,
      ]
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `UPDATE "InterviewStudyResult"
       SET "status" = 'failed',
           "error" = $2,
           "completedAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      [id, error]
    );
  }

  async getByRunId(runId: string): Promise<InterviewStudyRecord | null> {
    await this.ensureSchema();
    const result = await this.pool.query<StudyRow>(
      `SELECT * FROM "InterviewStudyResult" WHERE "runId" = $1 LIMIT 1`,
      [runId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async getLatestByStudyId(
    studyId: string
  ): Promise<InterviewStudyRecord | null> {
    await this.ensureSchema();
    const result = await this.pool.query<StudyRow>(
      `SELECT * FROM "InterviewStudyResult"
       WHERE "studyId" = $1
       ORDER BY "createdAt" DESC
       LIMIT 1`,
      [studyId]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async list(
    options: ListStudiesOptions
  ): Promise<{ studies: InterviewStudyRecord[]; total: number }> {
    await this.ensureSchema();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (options.userId) {
      values.push(options.userId);
      conditions.push(`"userId" = $${values.length}`);
    }
    if (options.status) {
      values.push(options.status);
      conditions.push(`"status" = $${values.length}`);
    }
    if (options.studyId) {
      values.push(options.studyId);
      conditions.push(`"studyId" = $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM "InterviewStudyResult" ${where}`,
      values
    );
    values.push(options.limit, options.offset);
    const rows = await this.pool.query<StudyRow>(
      `SELECT * FROM "InterviewStudyResult"
       ${where}
       ORDER BY "createdAt" DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    return {
      studies: rows.rows.map(mapRow),
      total: Number.parseInt(countResult.rows[0]?.count ?? "0", 10),
    };
  }

  private async updateStatus(
    id: string,
    status: InterviewStudyStatus
  ): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `UPDATE "InterviewStudyResult"
       SET "status" = $2, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = $1`,
      [id, status]
    );
  }

  private async ensureSchema(): Promise<void> {
    let ready = schemaReady.get(this.databaseUrl);
    if (!ready) {
      ready = this.createSchema();
      schemaReady.set(this.databaseUrl, ready);
    }
    try {
      await ready;
    } catch (error) {
      schemaReady.delete(this.databaseUrl);
      throw error;
    }
  }

  private async createSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await createTable(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function createTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "InterviewStudyResult" (
      "id" text PRIMARY KEY,
      "studyId" text NOT NULL,
      "runId" text,
      "studyName" text NOT NULL,
      "objective" text,
      "additionalContext" text,
      "questions" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "audienceRooms" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "enterpriseName" text NOT NULL,
      "userId" text NOT NULL,
      "userEmail" text,
      "status" varchar(16) NOT NULL DEFAULT 'queued',
      "resultData" text,
      "error" text,
      "questionCount" integer NOT NULL DEFAULT 0,
      "profileCount" integer,
      "responseCount" integer,
      "createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completedAt" timestamp without time zone,
      CONSTRAINT "InterviewStudyResult_status_check"
        CHECK ("status" IN ('queued', 'running', 'completed', 'failed'))
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS "InterviewStudyResult_runId_key"
    ON "InterviewStudyResult" ("runId")
    WHERE "runId" IS NOT NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "InterviewStudyResult_studyId_idx"
    ON "InterviewStudyResult" ("studyId")
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "InterviewStudyResult_userId_createdAt_idx"
    ON "InterviewStudyResult" ("userId", "createdAt" DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "InterviewStudyResult_status_createdAt_idx"
    ON "InterviewStudyResult" ("status", "createdAt" DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "InterviewStudyResult_createdAt_idx"
    ON "InterviewStudyResult" ("createdAt" DESC)
  `);
}

function mapRow(row: StudyRow): InterviewStudyRecord {
  return {
    id: row.id,
    studyId: row.studyId,
    runId: row.runId,
    studyName: row.studyName,
    objective: row.objective,
    additionalContext: row.additionalContext,
    questions: row.questions,
    audienceRooms: row.audienceRooms,
    enterpriseName: row.enterpriseName,
    userId: row.userId,
    userEmail: row.userEmail,
    status: row.status,
    resultDataUrl: row.resultData,
    error: row.error,
    questionCount: row.questionCount,
    profileCount: row.profileCount,
    responseCount: row.responseCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    completedAt: row.completedAt ? iso(row.completedAt) : null,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
