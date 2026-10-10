import OpenAI from "openai";
import { Settings } from "@/lib/settings";
import type { AudienceProfile, RoomProfiles } from "@/lib/types";

interface EnrichmentResponse {
  profiles?: Array<{ profileId?: string; name?: string }>;
}

interface RoomDescription {
  audience_room_name?: string;
  summary?: string;
  traits?: Array<{ title?: string; descriptions?: string[] }>;
}

export class ProfileService {
  private readonly settings = Settings.getInstance();

  async fetchRoom(
    audienceRoomId: string,
    maxProfiles: number,
    enterpriseName: string
  ): Promise<RoomProfiles> {
    const url = new URL(
      `${this.settings.profileEnrichmentApiBaseUrl}/profile-enrichment`
    );
    url.searchParams.set("audienceRoomId", audienceRoomId);
    url.searchParams.set("enterpriseName", enterpriseName);
    // Interview studies need the requested panel, not the reference workflow's
    // default k=1 enrichment behavior.
    url.searchParams.set("k", String(maxProfiles));

    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(
        `Profile enrichment failed for room ${audienceRoomId}: ${response.status}`
      );
    }

    const data = (await response.json()) as EnrichmentResponse;
    const seenProfileIds = new Set<string>();
    const selected = (data.profiles ?? [])
      .filter(
        (profile): profile is { profileId: string; name?: string } => {
          if (
            typeof profile.profileId !== "string" ||
            profile.profileId.length === 0 ||
            seenProfileIds.has(profile.profileId)
          ) {
            return false;
          }
          seenProfileIds.add(profile.profileId);
          return true;
        }
      )
      .slice(0, maxProfiles);

    const profiles: AudienceProfile[] = await Promise.all(
      selected.map(async (profile) => ({
        profileId: profile.profileId,
        name: profile.name?.trim() || "Unknown",
        profileSummary:
          (await this.fetchProfileSummary(
            audienceRoomId,
            profile.profileId,
            enterpriseName
          )) ?? "",
      }))
    );

    return {
      audienceRoomId,
      profiles,
      audienceRoomSummary:
        (await this.fetchRoomSummary(audienceRoomId, enterpriseName)) ??
        undefined,
    };
  }

  private async fetchProfileSummary(
    roomId: string,
    profileId: string,
    enterpriseName: string
  ): Promise<string | null> {
    const url = new URL(
      `${this.settings.profileDescriptionApiBaseUrl}/audience-rooms/${roomId}/profiles/${profileId}/description`
    );
    url.searchParams.set("enterpriseName", enterpriseName);
    try {
      const response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { summary?: string };
      return data.summary?.trim() || null;
    } catch {
      return null;
    }
  }

  private async fetchRoomSummary(
    roomId: string,
    enterpriseName: string
  ): Promise<string | null> {
    const url = new URL(
      `${this.settings.profileEnrichmentApiBaseUrl}/show-audience-room/show-room-description/${roomId}`
    );
    url.searchParams.set("enterpriseName", enterpriseName);
    try {
      const response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as RoomDescription;
      const deterministic = [
        data.audience_room_name,
        data.summary,
        ...(data.traits ?? []).map((trait) =>
          [trait.title, ...(trait.descriptions ?? [])].filter(Boolean).join(": ")
        ),
      ]
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!deterministic) return null;

      const openai = new OpenAI({ apiKey: this.settings.openaiApiKey });
      const completion = await openai.chat.completions.create({
        model: this.settings.openaiModel,
        temperature: 0.1,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content:
              "Condense this audience description into a neutral, concise persona context. Preserve behavioral priorities and constraints. Do not invent facts.",
          },
          { role: "user", content: deterministic },
        ],
      });
      return completion.choices[0]?.message?.content?.trim() || deterministic;
    } catch {
      return null;
    }
  }
}
