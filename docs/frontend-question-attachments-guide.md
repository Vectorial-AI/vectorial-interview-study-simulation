# Frontend Guide: Interview Question Attachments

## Overview

Interview studies can now include supporting files on individual questions.
These attachments give interview personas extra context such as screenshots,
concept images, PDFs, product briefs, or reference copy.

Attachments are submitted when starting a study through:

```http
POST /api/interview-study
```

This change is backward compatible. Existing string questions and object
questions without attachments continue to work.

## Important behavior

- Attachments belong to a specific question, not the entire study.
- Each question supports up to three attachments.
- Attachments are context only and are not answer options.
- The backend sends `summary` and `supportingText` to interview personas.
- The backend preserves attachment metadata in study history and completed
  reports.
- The backend does not upload, download, parse, or visually inspect files.
  The frontend must upload the file and provide a useful text summary.

## Request contract

Use the object form of a question to include attachments:

```ts
interface StartInterviewStudyRequest {
  studyId?: string;
  studyName: string;
  objective?: string;
  additionalContext?: string;
  questions: Array<string | InterviewQuestion>;
  audienceRooms: Array<{
    id: string;
    maxProfiles?: number;
  }>;
  enterpriseName: string;
  userId: string;
  userEmail?: string;
}

interface InterviewQuestion {
  id?: string;
  text: string;
  questionAssets?: InterviewContextAsset[];
}

interface InterviewContextAsset {
  /** Required persona-facing description of the file. */
  summary: string;

  /** Optional framing or instructions authored by the researcher. */
  supportingText?: string;

  contentType?: "image" | "document";
  mimeType?: string;
  url?: string;
  filename?: string;
}
```

## Example request

```json
{
  "studyId": "mobile-checkout-study",
  "studyName": "Mobile Checkout Interview",
  "objective": "Understand where customers lose confidence during checkout.",
  "additionalContext": "Focus on first-time mobile customers.",
  "questions": [
    {
      "id": "first-impression",
      "text": "What is your first impression of this checkout experience?",
      "questionAssets": [
        {
          "summary": "A mobile checkout showing delivery, payment, and order-review sections on one page.",
          "supportingText": "Treat this screenshot as the current production experience.",
          "contentType": "image",
          "mimeType": "image/png",
          "url": "https://example.com/mobile-checkout.png",
          "filename": "mobile-checkout.png"
        }
      ]
    },
    {
      "id": "abandonment",
      "text": "What might make you abandon this purchase?"
    }
  ],
  "audienceRooms": [
    {
      "id": "audience-room-id",
      "maxProfiles": 25
    }
  ],
  "enterpriseName": "beta",
  "userId": "user-id",
  "userEmail": "researcher@example.com"
}
```

## Frontend implementation

### 1. Add attachments to each question editor

Add an optional attachment control beside each interview question.

Recommended behavior:

- Accept images, PDFs, `.txt`, and `.md` files.
- Limit the selection to three files per question.
- Display the filename and upload state.
- Allow an attachment to be removed before starting the study.
- Provide an optional supporting-text input for researcher framing.

### 2. Upload files before starting the study

Upload each selected file using the frontend's existing file-storage flow.
Do not send raw file bytes or `File` objects to the interview-study endpoint.

For each successful upload, retain:

- Public or otherwise usable file URL
- Original filename
- MIME type
- Whether it is an image or document

### 3. Generate a summary

Every attachment must have a non-empty `summary`. Generate or collect a
description that contains the information the persona needs because the
interview-study backend does not inspect the file URL.

Good image summary:

> Mobile checkout with an order summary at the top, three form sections, a
> disabled Pay button, and an unexpected delivery charge.

Weak image summary:

> Screenshot.

Keep `summary` and `supportingText` separate:

- `summary` describes the contents of the file.
- `supportingText` explains the researcher's framing or intended use.

### 4. Build the API payload

Map uploaded frontend assets into `questionAssets`:

```ts
const questions = draftQuestions.map((question) => ({
  id: question.id,
  text: question.text,
  ...(question.attachments.length > 0
    ? {
        questionAssets: question.attachments.map((asset) => ({
          summary: asset.summary,
          ...(asset.supportingText
            ? { supportingText: asset.supportingText }
            : {}),
          contentType: asset.isImage ? "image" : "document",
          mimeType: asset.mimeType,
          url: asset.url,
          filename: asset.filename,
        })),
      }
    : {}),
}));
```

Then send the questions through the existing start request:

```ts
await startInterviewStudy(apiBaseUrl, {
  studyName,
  objective,
  additionalContext,
  questions,
  audienceRooms,
  enterpriseName,
  userId,
  userEmail,
});
```

### 5. Render attachments in results

Completed reports now include the submitted questions:

```ts
interface InterviewStudyReport {
  studyId: string;
  studyName: string;
  objective?: string;
  questions: InterviewQuestion[];
  questionSummaries: QuestionSummary[];
  // Other existing report fields...
}

interface QuestionSummary {
  questionId: string;
  question: string;
  questionAssets: InterviewContextAsset[];
  // Other existing summary fields...
}
```

Use `report.questions` when the frontend needs the complete submitted question
configuration. Use `questionSummaries[].questionAssets` when rendering
supporting material beside an individual summary.

For historical reports, use defensive defaults:

```ts
const questions = report.questions ?? [];
const assets = questionSummary.questionAssets ?? [];
```

When rendering:

- Show image previews when the URL and MIME type support them.
- Show a filename/link for documents.
- Display `supportingText` when present.
- Do not place attachments in answer lists, charts, or response counts.

### 6. Preserve attachments during reruns

When creating a new run from an existing study, copy each question's
`questionAssets` into the new start request. A file does not need to be
uploaded again when its existing URL remains valid.

## Validation

The API returns `400` when:

- `questionAssets` is not an array.
- A question contains more than three assets.
- An asset is not an object.
- An asset has a missing or empty `summary`.
- `supportingText`, `mimeType`, `url`, or `filename` is present but is not a
  string.
- `contentType` is present but is not `"image"` or `"document"`.

Whitespace is trimmed. Empty optional string fields are treated as absent.
Sending `questionAssets: []` is valid and is normalized the same as omitting
the field.

## Persona prompt behavior

For each question, the backend adds the attachment text beneath the original
question:

```text
What is your first impression of this checkout experience?

Supporting materials (context for this question):
1. mobile-checkout.png
   A mobile checkout showing delivery, payment, and order-review sections.
   Supporting text: Treat this screenshot as the current production experience.
```

The original question text remains unchanged in response and summary records.

## Frontend checklist

- Add an optional uploader to each interview question.
- Enforce a maximum of three files per question.
- Upload files before calling the interview-study API.
- Generate or require a meaningful `summary`.
- Keep `supportingText` separate from `summary`.
- Send normalized metadata through `questions[].questionAssets`.
- Render attachments from completed reports.
- Copy attachment metadata when rerunning a study.
- Treat attachment fields as optional for historical data.

