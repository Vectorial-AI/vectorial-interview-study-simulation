# Frontend Contract Update: Persona Reasoning

## Scope

This update affects completed interview-study reports returned by:

- `GET /api/interview-study/status/{runId}`
- `GET /api/interview-study/{studyId}?enterpriseName={enterpriseName}`
- The JSON report referenced by `resultDataUrl`

There are no request-body or endpoint changes.

## Updated individual response

Every successful persona response now includes an explicit reason and
normalized confidence:

```ts
interface IndividualResponse {
  questionId: string;
  question: string;
  questionIndex: number;
  profileId: string;
  profileName: string;
  profileSummary: string;
  audienceRoomId: string;

  /** First-person persona answer. */
  response: string;

  /** Persona-grounded explanation for the answer. */
  reason: string;

  /** Self-reported confidence normalized to the inclusive 0-1 range. */
  confidence: number;

  citations: Citation[];

  /** Historical/defensive field; not expected in newly completed reports. */
  error?: string;
}
```

Example:

```json
{
  "questionId": "checkout-friction",
  "question": "What makes you hesitate during checkout?",
  "questionIndex": 0,
  "profileId": "profile-123",
  "profileName": "Alex",
  "profileSummary": "A frequent mobile shopper who values predictable costs.",
  "audienceRoomId": "room-456",
  "response": "I hesitate when the final price changes after I have already entered my details.",
  "reason": "Unexpected fees make me feel that the retailer was not transparent, so I reconsider whether I trust the purchase.",
  "confidence": 0.86,
  "citations": []
}
```

## Summary contracts

The response shapes for both summary levels are unchanged:

- `questionSummaries[]` contains one aggregate summary for each question.
- `overallSummary` contains the final synthesis across all questions.

The backend now uses persona answers, reasons, and confidence when generating
question and participant summaries. Each `questionSummaries[]` item is produced
from all persona responses to that specific question. `overallSummary` is then
generated solely by synthesizing those per-question summaries.

Summary generation uses a strict response schema. A malformed or empty summary
fails and retries the workflow step instead of being published as
`"No summary available."`.

## Completion semantics

Questions are processed in submitted order. For each question, the backend
waits for every selected profile to return a valid `response`, `reason`, and
`confidence` before generating that question's summary and advancing.

A newly completed report therefore has:

```ts
report.individualResponses.length ===
  report.profileCount * report.questionCount;
```

If a profile call remains invalid after retries or fails permanently, the study
is marked `failed`; the backend does not publish a partial completed report.

## Frontend rendering guidance

For each persona answer:

1. Render `response` as the primary answer.
2. Render `reason` as supporting rationale.
3. Display `confidence` as a percentage using
   `Math.round(confidence * 100)`.
4. Key rows by
   `${questionId}:${audienceRoomId}:${profileId}`.

Do not use `questionSummaries[].notableQuotes` as the complete persona response
list; it intentionally contains only selected quotes. Use
`individualResponses` for the complete response explorer.

Previously stored report blobs may predate `reason` and `confidence`. When
rendering report history, use defensive fallbacks:

```ts
const reason = response.reason ?? "";
const confidence =
  typeof response.confidence === "number" ? response.confidence : null;
```

The complete API reference remains in
[`frontend-api-reference.md`](./frontend-api-reference.md).
