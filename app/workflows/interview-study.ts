import {
  askInterviewQuestionStep,
  fetchRoomProfilesStep,
  getCompletionTimestampStep,
  markStudyFailedStep,
  markStudyRunningStep,
  storeReportStep,
  summarizeProfileStep,
  summarizeQuestionStep,
  summarizeStudyStep,
  updateProgressStep,
} from "@/app/steps/interview-steps";
import type {
  IndividualResponse,
  InterviewStudyInput,
  InterviewStudyReport,
  InterviewStudyWorkflowOutput,
  QuestionSummary,
} from "@/lib/types";

export async function interviewStudyWorkflow(
  input: InterviewStudyInput
): Promise<InterviewStudyWorkflowOutput> {
  "use workflow";

  try {
    await markStudyRunningStep(input.enterpriseName, input.runId);
    await updateProgressStep(input.runId, {
      currentStep: 1,
      stepName: "fetching_profiles",
      totalQuestions: input.questions.length,
      percentage: 5,
    });

    const rooms = await Promise.all(
      input.audienceRooms.map((room) =>
        fetchRoomProfilesStep(room.id, room.maxProfiles, input.enterpriseName)
      )
    );
    const participants = rooms.flatMap((room) =>
      room.profiles.map((profile) => ({
        ...profile,
        audienceRoomId: room.audienceRoomId,
        audienceRoomSummary: room.audienceRoomSummary,
        participantKey: `${room.audienceRoomId}:${profile.profileId}`,
      }))
    );
    if (participants.length === 0) {
      throw new Error("No profiles were found for the supplied audience rooms");
    }

    const totalExpectedResponses = participants.length * input.questions.length;
    await updateProgressStep(input.runId, {
      currentStep: 1,
      stepName: "profiles_ready",
      totalProfiles: participants.length,
      percentage: 10,
    });

    const allResponses: IndividualResponse[] = [];
    const questionSummaries: QuestionSummary[] = [];

    for (
      let questionIndex = 0;
      questionIndex < input.questions.length;
      questionIndex++
    ) {
      const question = input.questions[questionIndex];
      await updateProgressStep(input.runId, {
        currentStep: 2,
        stepName: `interviewing_question_${questionIndex + 1}`,
        processedQuestions: questionIndex,
        percentage:
          10 +
          Math.round(
            (allResponses.length / Math.max(totalExpectedResponses, 1)) * 60
          ),
      });

      // Question barrier: every room completes all of its profile batches for
      // this question before any profile can advance to the next question.
      // Rooms run in parallel; batches within each room run sequentially.
      const priorQuestionResponses = [...allResponses];
      const responsesByRoom = await Promise.all(
        rooms.map(async (room) => {
          const roomParticipants = participants.filter(
            (participant) =>
              participant.audienceRoomId === room.audienceRoomId
          );
          const roomResponses: IndividualResponse[] = [];

          for (
            let offset = 0;
            offset < roomParticipants.length;
            offset += input.responseBatchSize
          ) {
            const batch = roomParticipants.slice(
              offset,
              offset + input.responseBatchSize
            );
            const responses = await Promise.all(
              batch.map((participant) =>
                askInterviewQuestionStep({
                  enterpriseName: input.enterpriseName,
                  userId: input.userId,
                  studyName: input.studyName,
                  objective: input.objective,
                  additionalContext: input.additionalContext,
                  questionId: question.id,
                  question: question.text,
                  questionIndex,
                  audienceRoomId: participant.audienceRoomId,
                  audienceRoomSummary: participant.audienceRoomSummary,
                  profileId: participant.profileId,
                  profileName: participant.name,
                  profileSummary: participant.profileSummary,
                  priorResponses: priorQuestionResponses
                    .filter(
                      (response) =>
                        `${response.audienceRoomId}:${response.profileId}` ===
                          participant.participantKey &&
                        !response.error &&
                        !!response.response
                    )
                    .map((response) => ({
                      question: response.question,
                      response: response.response,
                    })),
                })
              )
            );
            roomResponses.push(...responses);
          }

          return roomResponses;
        })
      );
      const questionResponses = responsesByRoom.flat();
      assertCompleteQuestionCoverage(
        question.id,
        participants,
        questionResponses
      );
      allResponses.push(...questionResponses);

      await updateProgressStep(input.runId, {
        currentStep: 2,
        stepName: `interviewing_question_${questionIndex + 1}`,
        processedResponses: allResponses.length,
        percentage:
          10 +
          Math.round(
            (allResponses.length / Math.max(totalExpectedResponses, 1)) * 60
          ),
      });

      questionSummaries.push(
        await summarizeQuestionStep(
          question.id,
          question.text,
          questionResponses
        )
      );
      await updateProgressStep(input.runId, {
        currentStep: 2,
        stepName: `question_${questionIndex + 1}_completed`,
        processedQuestions: questionIndex + 1,
      });
    }

    await updateProgressStep(input.runId, {
      currentStep: 3,
      stepName: "building_participant_summaries",
      percentage: 75,
    });

    const individualSummaries = await Promise.all(
      participants.map((participant) =>
        summarizeProfileStep(
          {
            profileId: participant.profileId,
            profileName: participant.name,
            profileSummary: participant.profileSummary,
            audienceRoomId: participant.audienceRoomId,
          },
          allResponses.filter(
            (response) =>
              `${response.audienceRoomId}:${response.profileId}` ===
              participant.participantKey
          )
        )
      )
    );
    const successfulResponseCount = allResponses.filter(
      (response) => !response.error && !!response.response
    ).length;
    const overallSummary = await summarizeStudyStep({
      studyName: input.studyName,
      objective: input.objective,
      questionSummaries,
      individualSummaries,
      requestedProfileCount: participants.length,
      successfulResponseCount,
    });
    const completedAt = await getCompletionTimestampStep();

    const report: InterviewStudyReport = {
      studyId: input.studyId,
      studyName: input.studyName,
      objective: input.objective,
      audienceRoomIds: input.audienceRooms.map((room) => room.id),
      questionCount: input.questions.length,
      profileCount: participants.length,
      responseCount: successfulResponseCount,
      completedAt,
      overallSummary,
      questionSummaries,
      individualSummaries,
      individualResponses: allResponses,
    };

    await updateProgressStep(input.runId, {
      currentStep: 4,
      stepName: "storing_report",
      percentage: 95,
    });
    const resultDataUrl = await storeReportStep(
      input.enterpriseName,
      input.runId,
      report
    );
    const result = { ...report, resultDataUrl };

    try {
      await updateProgressStep(input.runId, {
        currentStep: 4,
        stepName: "completed",
        percentage: 100,
      });
    } catch {
      // The tenant database already contains the durable completed result.
    }
    return { status: "completed", result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await markStudyFailedStep(input.enterpriseName, input.runId, message);
    } catch {
      // Preserve the original workflow error.
    }
    try {
      await updateProgressStep(input.runId, {
        currentStep: 0,
        stepName: "failed",
        percentage: 0,
      });
    } catch {
      // Preserve the original workflow error.
    }
    return { status: "failed", error: message };
  }
}

function assertCompleteQuestionCoverage(
  questionId: string,
  participants: Array<{
    audienceRoomId: string;
    profileId: string;
    participantKey: string;
  }>,
  responses: IndividualResponse[]
): void {
  const expectedCounts = countByKey(
    participants.map((participant) => participant.participantKey)
  );
  const actualCounts = countByKey(
    responses.map(
      (response) => `${response.audienceRoomId}:${response.profileId}`
    )
  );
  const mismatches = [...expectedCounts.entries()].filter(
    ([key, count]) => actualCounts.get(key) !== count
  );
  const unexpected = [...actualCounts.keys()].filter(
    (key) => !expectedCounts.has(key)
  );
  const unsuccessful = responses.filter(
    (response) =>
      !!response.error ||
      !response.response.trim() ||
      !response.reason.trim() ||
      !Number.isFinite(response.confidence)
  );

  if (
    responses.length !== participants.length ||
    mismatches.length > 0 ||
    unexpected.length > 0 ||
    unsuccessful.length > 0
  ) {
    throw new Error(
      `Incomplete response coverage for question ${questionId}: expected ${participants.length}, received ${responses.length}, successful ${responses.length - unsuccessful.length}`
    );
  }
}

function countByKey(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
