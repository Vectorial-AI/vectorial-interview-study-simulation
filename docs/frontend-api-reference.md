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

Questions are processed sequentially. For each question, the workflow asks
every selected profile separately. Earlier answers from the same profile are
included as context for later questions.

## Base URL

Use the deployed workflow application's origin:

```text
https://<workflow-host>
```

During local development this is typically:

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
```

Whitespace-only strings are treated as missing. Question IDs must be unique
within a study.

### Recommended request

The object form of `questions` is recommended because stable IDs make it
easier to connect report sections back to frontend records.

```json
{
  "studyId": "checkout-research-oct-2026",
  "studyName": "Checkout Experience Interview",
  "objective": "Understand why customers abandon checkout and what would increase confidence.",
  "additionalContext": "Focus on the current mobile checkout experience.",
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
}
```

Example:

```json
{
  "runId": "wrun_01J...",
  "studyId": "checkout-research-oct-2026",
  "status": "queued",
  "statusUrl": "/api/interview-study/status/wrun_01J..."
}
```

`runId` and `studyId` identify different things:

- `runId` identifies this workflow execution and is used for status polling.
- `studyId` identifies the report from the product's perspective.

Store both values in frontend state.

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
- `audienceRooms must be a non-empty array`
- `audienceRooms may contain at most 10 rooms`
- `audienceRooms[0].maxProfiles must be an integer from 1 to 100`
- `A study may request at most 100 profiles in total`

The endpoint currently uses `400` for validation errors and for startup
configuration failures. Display the returned `error` string, but do not assume
every `400` can be fixed by changing a single form field.

## 2. Get study status

```http
GET /api/interview-study/status/{runId}
```

Use the workflow `runId` returned by the start endpoint. Do not use `studyId`
in this URL.

### Running response

Status: `200 OK`

```ts
interface RunningInterviewStudyResponse {
  runId: string;
  status: "running";
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

### Unknown run

Status: `404 Not Found`

```json
{
  "runId": "unknown-run-id",
  "error": "Workflow run not found"
}
```

## Complete report schema

```ts
interface InterviewStudyReport {
  studyId: string;
  studyName: string;
  objective?: string;

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

  /** Verbatim chat-agent answer; empty when error is present. */
  response: string;

  citations: Citation[];

  /** Present when this individual interview call failed permanently. */
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

- `overallSummary` is the study-level report.
- `questionSummaries` contains one aggregate analysis per submitted question.
- `individualSummaries` contains one cross-question summary per profile.
- `individualResponses` contains the verbatim response for every attempted
  question/profile pair.
- `profileCount` is the number of profiles actually returned, not the requested
  maximum.
- `responseCount` counts successful raw answers.
- A failed individual response remains in `individualResponses` with an empty
  `response` and an `error`. It is excluded from generated summaries.
- Profile identity is unique by the combination of `audienceRoomId` and
  `profileId`. Use both values as a frontend list or map key.
- `resultDataUrl` points to a public JSON blob. The blob contains the report
  payload created before its own URL was known, so consumers should not depend
  on `resultDataUrl` being present inside the downloaded JSON.

## TypeScript frontend client

The following client contains the complete start, status, and polling flow:

```ts
export type StudyStatus =
  | {
      runId: string;
      status: "running";
      progress: InterviewProgress | null;
      result: null;
      error: null;
    }
  | {
      runId: string;
      status: "completed";
      progress: InterviewProgress | null;
      result: InterviewStudyReport;
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
  runId: string,
  signal?: AbortSignal,
): Promise<StudyStatus> {
  const response = await fetch(
    `${apiBaseUrl}/api/interview-study/status/${encodeURIComponent(runId)}`,
    { signal },
  );

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
  runId: string,
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
      runId,
      options.signal,
    );

    options.onProgress?.(status.progress);

    if (status.status === "completed") {
      return status.result;
    }

    if (status.status === "failed") {
      throw new Error(status.error);
    }

    await abortableDelay(intervalMs, options.signal);
  }
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
    const { runId } = state;

    waitForInterviewStudy(apiBaseUrl, runId, {
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

In production, persist `runId` and `studyId` outside transient component state
so polling can resume after navigation or page refresh.

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
- Persist the returned `runId` immediately.
- Retry temporary network failures with exponential backoff, but do not create
  a second study merely because a status request failed.
- A `404` generally means the run ID is invalid or belongs to another
  deployment/environment.
- Progress records have a 24-hour Redis TTL. The workflow status system remains
  the source of truth for completion.
- The current API does not provide cancellation, study listing, or lookup by
  `studyId`. Frontends must retain the workflow `runId` for status retrieval.

## Current endpoint summary

```text
POST /api/interview-study
  Starts a study.
  Returns: 202 queued, or 400 error.

GET /api/interview-study/status/{runId}
  Returns workflow progress and the final report.
  Returns: 200 running/completed/failed, or 404 unknown run.

OPTIONS /api/interview-study
OPTIONS /api/interview-study/status/{runId}
  CORS preflight.
```
