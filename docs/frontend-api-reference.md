# Interview Study Frontend API Reference

This document describes how a frontend starts an interview study, monitors its
progress, and renders the completed report.

## Overview

An interview study is asynchronous:

1. The frontend sends all study questions and audience-room selections to the
   start endpoint.
2. The API immediately returns `202 Accepted` with a workflow `runId`.
3. The frontend polls the status endpoint using that `runId`.
4. When the status becomes `completed`, the response contains the full report
   and a public JSON report URL.
5. The API keeps a durable metadata row in the selected tenant database, so
   history and completed results remain discoverable after Redis or workflow
   retention expires.

Questions are processed sequentially. For each question, audience rooms run in
parallel and each room processes profiles in sequential, configurable batches.
The workflow waits for every selected profile to return a valid response before
it summarizes that question or starts the next one. Earlier answers from the
same profile are included as context for later questions.

Persistence uses two stores:

- Each run's full report is written to Vercel Blob at
  `interview-studies/{enterpriseName}/{studyId}/{recordId}.json`.
- Job metadata and the Blob URL are written to the tenant's
  `InterviewStudyResult` Postgres table, selected through
  `{ENTERPRISE}_DIRECT_DATABASE_URL`.

The database row is created before the workflow is enqueued and moves through
`queued`, `running`, `completed`, or `failed`. The table is created
idempotently in a tenant database when this API first accesses that tenant.

## Base URL

Production:

```text
https://vectorial-interview-study-simulatio.vercel.app
```

The production API endpoints are therefore:

```text
POST https://vectorial-interview-study-simulatio.vercel.app/api/interview-study
GET  https://vectorial-interview-study-simulatio.vercel.app/api/interview-study?enterpriseName={tenant}
GET  https://vectorial-interview-study-simulatio.vercel.app/api/interview-study/status/{runId}?enterpriseName={tenant}
GET  https://vectorial-interview-study-simulatio.vercel.app/api/interview-study/{studyId}?enterpriseName={tenant}
```

During local development, use:

```text
http://localhost:3000
```

All endpoints accept cross-origin browser requests. The current API does not
require the frontend to send an authorization header. Authentication to
downstream services is handled by the workflow application.

## 1. Start an interview study

```http
POST /api/interview-study
Content-Type: application/json
```

### Request body

```ts
interface StartInterviewStudyRequest {
  /**
   * Optional stable application-level identifier.
   * A UUID is generated when this is omitted.
   */
  studyId?: string;

  /** Required non-empty display name. */
  studyName: string;

  /** Optional research goal used when interviewing and summarizing. */
  objective?: string;

  /** Optional background or constraints shared with every interview. */
  additionalContext?: string;

  /** Optional supporting files shared with every question. Max 3. */
  contextAssets?: InterviewContextAsset[];

  /**
   * Required, 1-50 questions.
   * Questions may use either the string or object form.
   */
  questions: Array<
    | string
    | {
        /** Optional; defaults to "question-<1-based index>". */
        id?: string;
        /** Required non-empty question text. */
        text: string;
      }
  >;

  /**
   * Required, 1-10 audience rooms.
   * The sum of maxProfiles across all rooms may not exceed 100.
   */
  audienceRooms: Array<{
    /** Required audience-room ID. */
    id: string;

    /**
     * Optional in JSON despite being shown as required by the normalized type.
     * Defaults to 25. Must be an integer from 1 through 100.
     */
    maxProfiles?: number;
  }>;

  /** Required enterprise/tenant name. */
  enterpriseName: string;

  /** Required ID of the user starting the study. */
  userId: string;

  /** Optional initiating-user email for application metadata. */
  userEmail?: string;
}

interface InterviewContextAsset {
  /** Required generated or authored description; the backend does not inspect the file. */
  summary: string;
  /** Optional author-provided framing shown to interview personas. */
  supportingText?: string;
  contentType?: "image" | "document";
  mimeType?: string;
  url?: string;
  filename?: string;
}
```

Whitespace-only strings are treated as missing. Question IDs must be unique
within a study. A study may include up to three `contextAssets`, which are
shared with every question. The
backend passes `summary` and `supportingText` to personas and preserves the
remaining metadata for frontend display; it does not download or inspect the
asset URL.

### Recommended request

The object form of `questions` is recommended because stable IDs make it
easier to connect report sections back to frontend records.

```json
{
  "studyId": "checkout-research-oct-2026",
  "studyName": "Checkout Experience Interview",
  "objective": "Understand why customers abandon checkout and what would increase confidence.",
  "additionalContext": "Focus on the current mobile checkout experience.",
  "contextAssets": [
    {
      "summary": "Mobile checkout with delivery, payment, and order-review steps.",
      "supportingText": "Treat this as the current checkout experience.",
      "contentType": "image",
      "mimeType": "image/png",
      "url": "https://example.com/mobile-checkout.png",
      "filename": "mobile-checkout.png"
    }
  ],
  "questions": [
    {
      "id": "current-experience",
      "text": "Tell me about your current experience completing an online checkout."
    },
    {
      "id": "abandonment",
      "text": "What would make you stop before completing the purchase?"
    },
    {
      "id": "improvements",
      "text": "What change would most improve your confidence in the checkout?"
    }
  ],
  "audienceRooms": [
    {
      "id": "audience-room-uuid",
      "maxProfiles": 25
    }
  ],
  "enterpriseName": "beta",
  "userId": "user-uuid",
  "userEmail": "researcher@example.com"
}
```

The compact string form is also accepted:

```json
{
  "studyName": "Checkout Experience Interview",
  "questions": [
    "Tell me about your current checkout experience.",
    "What would make you abandon a purchase?"
  ],
  "audienceRooms": [{ "id": "audience-room-uuid" }],
  "enterpriseName": "beta",
  "userId": "user-uuid"
}
```

These questions receive the generated IDs `question-1` and `question-2`.

### Successful response

Status: `202 Accepted`

```ts
interface StartInterviewStudyResponse {
  /** Workflow run ID. Use this value when polling status. */
  runId: string;

  /** Supplied studyId, or the generated UUID when it was omitted. */
  studyId: string;

  status: "queued";

  /** Relative status endpoint. */
  statusUrl: string;

  /** Relative endpoint for loading this study after the workflow has expired. */
  resultUrl: string;
}
```

Example:

```json
{
  "runId": "wrun_01J...",
  "studyId": "checkout-research-oct-2026",
  "status": "queued",
  "statusUrl": "/api/interview-study/status/wrun_01J...?enterpriseName=beta",
  "resultUrl": "/api/interview-study/checkout-research-oct-2026?enterpriseName=beta"
}
```

`runId` and `studyId` identify different things:

- `runId` identifies this workflow execution and is used for status polling.
- `studyId` identifies the report from the product's perspective.

Store both IDs and both returned URLs in frontend state. The API creates a
tenant database row before starting the workflow, then replaces its temporary
tracking ID with the public workflow `runId`. Reusing a caller-supplied
`studyId` creates another history row; `resultUrl` resolves the newest run for
that `studyId`.

### Validation or startup failure

Status: `400 Bad Request`

```ts
interface StartInterviewStudyError {
  error: string;
}
```

Possible messages include:

- `studyName is required`
- `enterpriseName is required`
- `userId is required`
- `questions must be a non-empty array`
- `questions may contain at most 50 items`
- `question IDs must be unique`
- `contextAssets must be an array`
- `contextAssets may contain at most 3 assets`
- `contextAssets[0].summary is required`
- `audienceRooms must be a non-empty array`
- `audienceRooms may contain at most 10 rooms`
- `audience room IDs must be unique`
- `audienceRooms[0].maxProfiles must be an integer from 1 to 100`
- `A study may request at most 100 profiles in total`

The endpoint currently uses `400` for validation errors and for startup
configuration failures. Display the returned `error` string, but do not assume
every `400` can be fixed by changing a single form field.

## 2. Get study status

```http
GET /api/interview-study/status/{runId}?enterpriseName={tenant}
```

Use the returned `statusUrl`; it includes the tenant needed to fall back to the
persisted record after the workflow runtime no longer retains the run. Do not
use `studyId` in this URL.

### Running response

Status: `200 OK`

```ts
interface RunningInterviewStudyResponse {
  runId: string;
  status: "queued" | "running";
  progress: InterviewProgress | null;
  result: null;
  error: null;
}
```

Example:

```json
{
  "runId": "wrun_01J...",
  "status": "running",
  "progress": {
    "runId": "d9beb30e-...",
    "currentStep": 2,
    "stepName": "interviewing_question_2",
    "totalSteps": 4,
    "totalQuestions": 3,
    "processedQuestions": 1,
    "totalProfiles": 25,
    "processedResponses": 37,
    "percentage": 40,
    "lastUpdate": "2026-10-08T12:00:00.000Z"
  },
  "result": null,
  "error": null
}
```

The nested `progress.runId` is the workflow's internal tracking ID and may
differ from the top-level public workflow `runId`. Frontends should continue
polling with the top-level value.

### Progress object

```ts
interface InterviewProgress {
  runId: string;
  currentStep: number;
  stepName: string;
  totalSteps: 4;
  totalQuestions: number;
  processedQuestions: number;
  totalProfiles: number;
  processedResponses: number;
  percentage: number;
  lastUpdate: string;
}
```

`currentStep` meanings:

1. Fetch profiles.
2. Interview profiles and summarize each question.
3. Build participant and overall summaries.
4. Store the report.

Possible `stepName` values:

- `queued`
- `fetching_profiles`
- `profiles_ready`
- `interviewing_question_<number>`
- `question_<number>_completed`
- `building_participant_summaries`
- `storing_report`
- `completed`
- `failed`

Treat `stepName` as display metadata rather than a strict enum. New workflow
versions may add more values. Use `percentage` for the main progress bar and
the count fields for detailed copy.

Progress can be `null` briefly if the workflow exists but its Redis progress
record is unavailable. Keep polling based on the top-level `status`.

### Completed response

Status: `200 OK`

```ts
interface CompletedInterviewStudyResponse {
  runId: string;
  status: "completed";
  progress: InterviewProgress | null;
  result: InterviewStudyReport;
  error: null;
}
```

### Failed response

Status: `200 OK`

```ts
interface FailedInterviewStudyResponse {
  runId: string;
  status: "failed";
  progress: InterviewProgress | null;
  result: null;
  error: string;
}
```

A failed workflow is represented by the JSON `status`, not by an HTTP error
status. Always inspect `body.status`.

### Persisted status fallback

The API checks Workflow DevKit first. If that run is no longer available and
`enterpriseName` was supplied, it loads the durable tenant record by `runId`.
The fallback response adds `studyId` and `resultDataUrl`:

```ts
interface PersistedInterviewStudyStatusResponse {
  runId: string;
  studyId: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: null;
  result: InterviewStudyReport | null;
  resultDataUrl: string | null;
  error: string | null;
}
```

For a completed record, the API attempts to load `result` from
`resultDataUrl`. If `result` is unavailable, clients may fetch the URL directly
or use the persisted study endpoint.

### Unknown run

Status: `404 Not Found`

```json
{
  "runId": "unknown-run-id",
  "error": "Workflow run not found"
}
```

This `404` is returned only when neither the workflow runtime nor the selected
tenant database contains the run. A tenant database lookup failure returns
`500` with `Persisted workflow status could not be loaded`.

## 3. List study history

```http
GET /api/interview-study?enterpriseName=beta&userId={userId}&limit=25&offset=0
```

`enterpriseName` is required. `userId`, `studyId`, and `status` are optional
filters. `status` accepts `queued`, `running`, `completed`, or `failed`.
`limit` defaults to 25 and is capped at 100.

```ts
interface InterviewStudyHistoryResponse {
  studies: InterviewStudyRecord[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

interface InterviewStudyRecord {
  /** Internal immutable record ID for this execution. */
  id: string;

  /** Application-level study ID; multiple runs may share this value. */
  studyId: string;

  /** Public workflow run ID used by the status endpoint. */
  runId: string | null;

  studyName: string;
  objective: string | null;
  additionalContext: string | null;
  contextAssets: InterviewContextAsset[];
  questions: Array<{ id: string; text: string }>;
  audienceRooms: Array<{ id: string; maxProfiles: number }>;
  enterpriseName: string;
  userId: string;
  userEmail: string | null;
  status: "queued" | "running" | "completed" | "failed";

  /** Public report Blob URL after completion. */
  resultDataUrl: string | null;

  error: string | null;
  questionCount: number;
  profileCount: number | null;
  responseCount: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
```

Rows are returned newest first. They include the original questions and room
selection, lifecycle status, counts, error details, timestamps, and
`resultDataUrl` for completed studies.

Example:

```json
{
  "studies": [
    {
      "id": "d9beb30e-...",
      "studyId": "checkout-research-oct-2026",
      "runId": "wrun_01J...",
      "studyName": "Checkout Experience Interview",
      "objective": "Understand checkout abandonment.",
      "additionalContext": null,
      "contextAssets": [],
      "questions": [
        { "id": "abandonment", "text": "What would make you stop?" }
      ],
      "audienceRooms": [
        { "id": "audience-room-uuid", "maxProfiles": 25 }
      ],
      "enterpriseName": "beta",
      "userId": "user-uuid",
      "userEmail": "researcher@example.com",
      "status": "completed",
      "resultDataUrl": "https://...blob.vercel-storage.com/interview-studies/beta/checkout-research-oct-2026/d9beb30e-....json",
      "error": null,
      "questionCount": 1,
      "profileCount": 25,
      "responseCount": 25,
      "createdAt": "2026-10-09T14:00:00.000Z",
      "updatedAt": "2026-10-09T14:10:00.000Z",
      "completedAt": "2026-10-09T14:10:00.000Z"
    }
  ],
  "total": 1,
  "limit": 25,
  "offset": 0,
  "hasMore": false
}
```

Use `offset + limit` for the next page when `hasMore` is `true`. To open an
older run when multiple records share a `studyId`, fetch that row's
`resultDataUrl` directly.

Invalid filters return `400`. `limit` must be 1-100, `offset` must be
0-10,000, and `status` must use one of the four documented values.

## 4. Get a persisted study result

```http
GET /api/interview-study/{studyId}?enterpriseName=beta
```

This returns the newest run for the supplied application-level `studyId`.
Completed records include the full report loaded from the stored blob:

```ts
interface PersistedInterviewStudyResponse {
  study: InterviewStudyRecord;
  result: InterviewStudyReport | null;
}
```

Use `includeResult=false` to return metadata without downloading the report.
This endpoint and the database fallback in the status endpoint remain usable
after the Redis progress record's 24-hour TTL or workflow retention window.

Responses:

- `200`: `{ study, result }`
- `400`: missing `enterpriseName`
- `404`: no record for that `studyId` in the selected tenant
- `500`: tenant database or stored Blob could not be loaded

Each tenant database owns its own `InterviewStudyResult` table. A row is
created before the workflow starts and transitions through `queued`, `running`,
`completed`, or `failed`; completed rows store the blob URL in `resultData`.
For example, `enterpriseName: "beta"` selects
`BETA_DIRECT_DATABASE_URL`. Tenant names are uppercased and non-alphanumeric
characters become underscores when resolving the environment variable. The
database role must be able to create the table and indexes on first access.

## Complete report schema

```ts
interface InterviewStudyReport {
  studyId: string;
  studyName: string;
  objective?: string;

  /** Supporting material shared with every question. */
  contextAssets: InterviewContextAsset[];

  /** Submitted interview questions. */
  questions: Array<{ id: string; text: string }>;

  /** All requested audience-room IDs. */
  audienceRoomIds: string[];

  questionCount: number;

  /** Actual profiles returned by enrichment, which can be below the requested count. */
  profileCount: number;

  /** Count of successful answers, not including response records with an error. */
  responseCount: number;

  completedAt: string;

  overallSummary: OverallSummary;
  questionSummaries: QuestionSummary[];
  individualSummaries: IndividualSummary[];

  /**
   * One record per attempted profile/question pair, including failed attempts.
   * These are the raw individual interview answers.
   */
  individualResponses: IndividualResponse[];

  /**
   * Public URL for the persisted JSON report.
   * Present in the status endpoint's completed result.
   */
  resultDataUrl?: string;
}

interface OverallSummary {
  executiveSummary: string;
  keyFindings: string[];
  sharedNeeds: string[];
  tensions: string[];
  recommendations: string[];
  limitations: string[];
}

interface QuestionSummary {
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

interface IndividualSummary {
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

interface IndividualResponse {
  questionId: string;
  question: string;

  /** Zero-based position in the submitted questions array. */
  questionIndex: number;

  profileId: string;
  profileName: string;
  profileSummary: string;
  audienceRoomId: string;

  /** Substantive first-person persona answer; empty when error is present. */
  response: string;

  /** Persona-grounded explanation for the answer; empty when error is present. */
  reason: string;

  /** Self-reported answer confidence from 0 through 1; 0 when error is present. */
  confidence: number;

  citations: Citation[];

  /** Defensive/backward-compatible field; completed reports do not contain errors. */
  error?: string;
}

interface Citation {
  fileTitle: string;
  postText: string;
  postUrl: string;
  relevanceScore?: number;
}
```

### Report semantics

- `questionSummaries` contains one aggregate analysis generated from all
  persona answers to each submitted question.
- `contextAssets` preserves the study-level attachment metadata used as shared
  context for every question.
- `overallSummary` is the study-level report generated from those completed
  per-question summaries.
- `individualSummaries` contains one cross-question summary per profile.
- `individualResponses` contains each persona's answer, explicit reason, and
  confidence for every attempted question/profile pair.
- Persona turns use the same structured open-ended response contract as the
  audience-response simulation: `answer` is exposed as `response`, alongside
  `reason` and normalized `confidence`.
- `profileCount` is the number of profiles actually returned, not the requested
  maximum.
- `responseCount` counts successful raw answers.
- A study is marked `completed` only after every profile has a valid answer,
  reason, and confidence for every question. Invalid agent output is retried.
  If retries are exhausted or a permanent call fails, the study is marked
  `failed` instead of publishing a partial report.
- Profile identity is unique by the combination of `audienceRoomId` and
  `profileId`. Use both values as a frontend list or map key.
- `resultDataUrl` points to a public JSON blob. The blob contains the report
  payload created before its own URL was known, so consumers should not depend
  on `resultDataUrl` being present inside the downloaded JSON.

## TypeScript frontend client

The following client contains start, status, polling, history, and persisted
result retrieval:

```ts
export type StudyStatus =
  | {
      runId: string;
      status: "queued" | "running";
      progress: InterviewProgress | null;
      result: null;
      error: null;
    }
  | {
      runId: string;
      status: "completed";
      progress: InterviewProgress | null;
      result: InterviewStudyReport | null;
      resultDataUrl?: string | null;
      error: null;
    }
  | {
      runId: string;
      status: "failed";
      progress: InterviewProgress | null;
      result: null;
      error: string;
    };

export class InterviewStudyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function startInterviewStudy(
  apiBaseUrl: string,
  input: StartInterviewStudyRequest,
  signal?: AbortSignal,
): Promise<StartInterviewStudyResponse> {
  const response = await fetch(`${apiBaseUrl}/api/interview-study`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });

  const body = await response.json();
  if (!response.ok) {
    throw new InterviewStudyApiError(
      body.error ?? "Unable to start interview study",
      response.status,
    );
  }

  return body as StartInterviewStudyResponse;
}

export async function getInterviewStudyStatus(
  apiBaseUrl: string,
  statusUrl: string,
  signal?: AbortSignal,
): Promise<StudyStatus> {
  const response = await fetch(new URL(statusUrl, apiBaseUrl), { signal });

  const body = await response.json();
  if (!response.ok) {
    throw new InterviewStudyApiError(
      body.error ?? "Unable to load interview study status",
      response.status,
    );
  }

  return body as StudyStatus;
}

export async function waitForInterviewStudy(
  apiBaseUrl: string,
  statusUrl: string,
  options: {
    signal?: AbortSignal;
    intervalMs?: number;
    onProgress?: (progress: InterviewProgress | null) => void;
  } = {},
): Promise<InterviewStudyReport> {
  const intervalMs = options.intervalMs ?? 2000;

  while (true) {
    const status = await getInterviewStudyStatus(
      apiBaseUrl,
      statusUrl,
      options.signal,
    );

    options.onProgress?.(status.progress);

    if (status.status === "completed") {
      if (status.result) return status.result;
      if (status.resultDataUrl) {
        const reportResponse = await fetch(status.resultDataUrl, {
          signal: options.signal,
        });
        if (reportResponse.ok) {
          return (await reportResponse.json()) as InterviewStudyReport;
        }
      }
      throw new Error("Completed study report is unavailable");
    }

    if (status.status === "failed") {
      throw new Error(status.error);
    }

    await abortableDelay(intervalMs, options.signal);
  }
}

export async function listInterviewStudies(
  apiBaseUrl: string,
  input: {
    enterpriseName: string;
    userId?: string;
    studyId?: string;
    status?: "queued" | "running" | "completed" | "failed";
    limit?: number;
    offset?: number;
  },
  signal?: AbortSignal,
): Promise<InterviewStudyHistoryResponse> {
  const url = new URL("/api/interview-study", apiBaseUrl);
  url.searchParams.set("enterpriseName", input.enterpriseName);
  if (input.userId) url.searchParams.set("userId", input.userId);
  if (input.studyId) url.searchParams.set("studyId", input.studyId);
  if (input.status) url.searchParams.set("status", input.status);
  if (input.limit !== undefined) {
    url.searchParams.set("limit", String(input.limit));
  }
  if (input.offset !== undefined) {
    url.searchParams.set("offset", String(input.offset));
  }

  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok) {
    throw new InterviewStudyApiError(
      body.error ?? "Unable to list interview studies",
      response.status,
    );
  }
  return body as InterviewStudyHistoryResponse;
}

export async function getPersistedInterviewStudy(
  apiBaseUrl: string,
  resultUrl: string,
  options: { includeResult?: boolean; signal?: AbortSignal } = {},
): Promise<PersistedInterviewStudyResponse> {
  const url = new URL(resultUrl, apiBaseUrl);
  if (options.includeResult === false) {
    url.searchParams.set("includeResult", "false");
  }

  const response = await fetch(url, { signal: options.signal });
  const body = await response.json();
  if (!response.ok) {
    throw new InterviewStudyApiError(
      body.error ?? "Unable to load persisted interview study",
      response.status,
    );
  }
  return body as PersistedInterviewStudyResponse;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeout = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
```

Use an environment variable for the workflow application's browser-safe base
URL, for example:

```ts
const apiBaseUrl = import.meta.env.VITE_INTERVIEW_WORKFLOW_URL;
```

For Next.js frontends, use a public variable such as:

```ts
const apiBaseUrl = process.env.NEXT_PUBLIC_INTERVIEW_WORKFLOW_URL!;
```

## React integration example

```tsx
import { useEffect, useState } from "react";

type StudyViewState =
  | { phase: "idle" }
  | { phase: "starting" }
  | {
      phase: "running";
      runId: string;
      studyId: string;
      statusUrl: string;
      resultUrl: string;
      progress: InterviewProgress | null;
    }
  | { phase: "completed"; report: InterviewStudyReport }
  | { phase: "failed"; message: string };

export function InterviewStudyRunner() {
  const [state, setState] = useState<StudyViewState>({ phase: "idle" });
  const apiBaseUrl = process.env.NEXT_PUBLIC_INTERVIEW_WORKFLOW_URL!;

  async function startStudy(input: StartInterviewStudyRequest) {
    setState({ phase: "starting" });

    try {
      const started = await startInterviewStudy(apiBaseUrl, input);
      setState({
        phase: "running",
        runId: started.runId,
        studyId: started.studyId,
        statusUrl: started.statusUrl,
        resultUrl: started.resultUrl,
        progress: null,
      });
    } catch (error) {
      setState({
        phase: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  useEffect(() => {
    if (state.phase !== "running") return;

    const controller = new AbortController();
    const { runId, statusUrl } = state;

    waitForInterviewStudy(apiBaseUrl, statusUrl, {
      signal: controller.signal,
      intervalMs: 2000,
      onProgress: (progress) => {
        setState((current) =>
          current.phase === "running" && current.runId === runId
            ? { ...current, progress }
            : current,
        );
      },
    })
      .then((report) => setState({ phase: "completed", report }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({
          phase: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => controller.abort();
  }, [apiBaseUrl, state.phase === "running" ? state.runId : null]);

  // Render your form, progress screen, error state, or report using `state`.
  return null;
}
```

In production, persist `runId`, `studyId`, `statusUrl`, and `resultUrl` outside
transient component state so polling can resume after navigation or page
refresh.

## Recommended report UI

Render the completed result in this order:

1. Executive summary from `overallSummary.executiveSummary`.
2. Key findings, shared needs, tensions, recommendations, and limitations.
3. One section per item in `questionSummaries`.
4. Participant cards from `individualSummaries`.
5. A raw-response explorer grouped by `questionId` or by the combined
   `audienceRoomId:profileId` identity.
6. Citation links from each raw response.

Show the successful response coverage:

```ts
const expectedResponses = report.profileCount * report.questionCount;
const coverage =
  expectedResponses === 0
    ? 0
    : Math.round((report.responseCount / expectedResponses) * 100);
```

Do not derive this value from `individualResponses.length`, because that array
also includes failed interview attempts.

## Polling and recovery recommendations

- Poll every 2-5 seconds. Faster polling does not make the workflow complete
  sooner.
- Stop polling only when JSON `status` is `completed` or `failed`.
- Use an `AbortController` when leaving the page.
- Persist the returned IDs and URLs immediately.
- Retry temporary network failures with exponential backoff, but do not create
  a second study merely because a status request failed.
- A `404` generally means the run ID is invalid or belongs to another
  deployment/environment.
- Progress records have a 24-hour Redis TTL. The tenant database remains the
  durable source of truth after progress or workflow retention expires.
- The current API does not provide cancellation. Listing and lookup by
  `studyId` are available through the persisted study endpoints.

## Current endpoint summary

```text
POST /api/interview-study
  Starts a study.
  Returns: 202 queued, or 400 error.

GET /api/interview-study?enterpriseName={tenant}
  Lists persisted studies with optional filters and pagination.
  Optional: userId, studyId, status, limit, offset.
  Returns: 200 history, or 400 invalid query/configuration.

GET /api/interview-study/status/{runId}?enterpriseName={tenant}
  Returns live workflow progress or durable database fallback.
  Returns: 200 queued/running/completed/failed, 404 unknown run, or 500
  persisted-status lookup failure.

GET /api/interview-study/{studyId}?enterpriseName={tenant}
  Returns the newest persisted run and, by default, its completed report.
  Optional: includeResult=false.
  Returns: 200 result, 400 missing tenant, 404 unknown study, or 500
  database/Blob lookup failure.

OPTIONS /api/interview-study
OPTIONS /api/interview-study/status/{runId}
OPTIONS /api/interview-study/{studyId}
  CORS preflight.
```
