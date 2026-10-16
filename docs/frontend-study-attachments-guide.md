# Frontend Guide: Interview Study Attachments

## What changed

An interview study can include up to three supporting attachments when it is
started. These attachments provide shared background for the whole study.

Every persona receives the same attachment context for every interview
question.

Attachments are not configured per question and are not answer options.

## Endpoint

```http
POST /api/interview-study
Content-Type: application/json
```

## Request contract

Add the optional top-level `contextAssets` field:

```ts
interface StartInterviewStudyRequest {
  studyId?: string;
  studyName: string;
  objective?: string;
  additionalContext?: string;

  /** Shared supporting material for every question. Maximum 3. */
  contextAssets?: InterviewContextAsset[];

  questions: Array<
    | string
    | {
        id?: string;
        text: string;
      }
  >;

  audienceRooms: Array<{
    id: string;
    maxProfiles?: number;
  }>;

  enterpriseName: string;
  userId: string;
  userEmail?: string;
}

interface InterviewContextAsset {
  /** Required description supplied to the personas. */
  summary: string;

  /** Optional researcher-authored framing or instructions. */
  supportingText?: string;

  contentType?: "image" | "document";
  mimeType?: string;
  url?: string;
  filename?: string;
}
```

## Example

```json
{
  "studyId": "mobile-checkout-study",
  "studyName": "Mobile Checkout Interview",
  "objective": "Understand where customers lose confidence during checkout.",
  "additionalContext": "Focus on first-time mobile customers.",
  "contextAssets": [
    {
      "summary": "A mobile checkout showing delivery, payment, and order-review sections on one page.",
      "supportingText": "Treat this screenshot as the current production experience.",
      "contentType": "image",
      "mimeType": "image/png",
      "url": "https://example.com/mobile-checkout.png",
      "filename": "mobile-checkout.png"
    }
  ],
  "questions": [
    {
      "id": "first-impression",
      "text": "What is your first impression of this checkout experience?"
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

### 1. Add one study-level uploader

Place one optional attachment uploader in the interview-study setup form, not
inside individual question editors.

Recommended behavior:

- Allow up to three files.
- Support the file types accepted by the existing upload system.
- Display upload progress, filename, and removal controls.
- Allow optional supporting text for each attachment.

### 2. Upload and summarize files

Upload files before calling the interview-study endpoint. Do not send raw
`File` objects or multipart data to this API.

The backend does not download or inspect the asset URL. Each attachment must
therefore include a meaningful `summary` describing the information personas
should consider.

Keep these fields separate:

- `summary`: describes the file contents.
- `supportingText`: explains how the researcher wants the file interpreted.

### 3. Build `contextAssets`

```ts
const contextAssets = uploadedAttachments.map((asset) => ({
  summary: asset.summary,
  ...(asset.supportingText
    ? { supportingText: asset.supportingText }
    : {}),
  contentType: asset.isImage ? "image" : "document",
  mimeType: asset.mimeType,
  url: asset.url,
  filename: asset.filename,
}));
```

Send this array once at the top level:

```ts
await startInterviewStudy(apiBaseUrl, {
  studyName,
  objective,
  additionalContext,
  contextAssets,
  questions,
  audienceRooms,
  enterpriseName,
  userId,
  userEmail,
});
```

Do not add attachment fields to entries in `questions`.

## Backend behavior

For every question, the backend appends the same study-level context:

```text
What is your first impression of this checkout experience?

Study supporting materials (shared context for every interview question):
1. mobile-checkout.png
   A mobile checkout showing delivery, payment, and order-review sections.
   Supporting text: Treat this screenshot as the current production experience.
```

The backend stores `contextAssets` once with the study and includes them in the
completed report.

## Results contract

```ts
interface InterviewStudyReport {
  studyId: string;
  studyName: string;
  objective?: string;

  /** Shared attachment metadata used for all questions. */
  contextAssets: InterviewContextAsset[];

  // Existing report fields...
}
```

Study history records also include:

```ts
contextAssets: InterviewContextAsset[];
```

For historical data created before this feature:

```ts
const contextAssets = report.contextAssets ?? [];
```

Render the attachments once near the study title, objective, or overview. Do
not repeat them under every question unless the product design explicitly
requires that presentation.

## Validation

The API returns `400` when:

- `contextAssets` is not an array.
- More than three assets are supplied.
- An asset is not an object.
- An asset has no non-empty `summary`.
- `contentType` is not `"image"` or `"document"`.
- An optional metadata field is present with a non-string value.

Sending `contextAssets: []` is valid. Omitting `contextAssets` preserves the
existing no-attachment behavior.

## Reruns

Copy the existing top-level `contextAssets` into a rerun request. Files do not
need to be uploaded again while their URLs remain valid.

## Checklist

- Add one uploader to the study setup.
- Enforce a maximum of three attachments per study.
- Upload files before starting the study.
- Require or generate a meaningful summary.
- Send attachments through top-level `contextAssets`.
- Never place attachments inside individual questions.
- Render attachment metadata from history and completed reports.
- Preserve `contextAssets` during reruns.
- Default missing historical `contextAssets` to `[]`.

