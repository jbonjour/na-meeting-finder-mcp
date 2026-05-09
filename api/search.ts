import type { VercelRequest, VercelResponse } from "@vercel/node";
import Anthropic from "@anthropic-ai/sdk";
import {
  searchMeetings,
  getFormats,
  formatMeeting,
  type BmltMeeting,
} from "../lib/bmlt.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HELPLINES: Record<string, string> = {
  "Portland Area": "(503) 345-9839",
  "Clackamas County": "(877) 551-4662",
  "Washington County": "(877) 551-4662",
  "Yamhill Unified": "(877) 551-4662",
};

const FIND_MEETINGS_TOOL: Anthropic.Tool = {
  name: "find_meetings",
  description:
    "Search for NA meetings in the Portland metro area (Portland Area, Clackamas County, Washington County, Yamhill Unified). " +
    "Returns formatted meeting results. Call this whenever the user is looking for meetings.",
  input_schema: {
    type: "object" as const,
    properties: {
      weekdays: {
        type: "array",
        items: { type: "number", minimum: 1, maximum: 7 },
        description: "Day(s) of the week as numbers: 1=Sunday, 2=Monday, …, 7=Saturday. Omit for all days.",
      },
      start_time_min: {
        type: "string",
        description: "Earliest start time in HH:MM 24-hour format, e.g. '18:00' for 6 PM.",
      },
      start_time_max: {
        type: "string",
        description: "Latest start time in HH:MM 24-hour format.",
      },
      meeting_name: {
        type: "string",
        description: "Partial name to search for within meeting names.",
      },
    },
    required: [],
  },
};

async function executeFindMeetings(
  input: Record<string, unknown>
): Promise<{ text: string; meetings: BmltMeeting[] }> {
  const [formats, meetings] = await Promise.all([getFormats(), searchMeetings({
    weekdays: input.weekdays as number[] | undefined,
    startTimeMin: input.start_time_min as string | undefined,
    startTimeMax: input.start_time_max as string | undefined,
    meetingName: input.meeting_name as string | undefined,
  })]);

  const formatMap = Object.fromEntries(
    formats.map((f) => [f.key_string, f.name_string])
  );

  if (meetings.length === 0) {
    return { text: "No meetings found matching those criteria.", meetings: [] };
  }

  const cap = 20;
  const shown = meetings.slice(0, cap);
  const lines = shown.map((m) => formatMeeting(m, formatMap));
  const trailer =
    meetings.length > cap
      ? `\n_Showing ${cap} of ${meetings.length} meetings. Narrow your search for more specific results._`
      : "";

  return {
    text: lines.join("\n\n") + trailer,
    meetings: shown,
  };
}

function todayContext(): string {
  const now = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return `Today is ${days[now.getDay()]}, ${now.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })}. Current time is ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`;
}

const SYSTEM_PROMPT = `You are a friendly, compassionate NA meeting finder assistant for the Portland metro area. You help people find Narcotics Anonymous meetings in Portland Area, Clackamas County, Washington County, and Yamhill Unified.

${todayContext()}

Your role:
- Help users find NA meetings using natural language
- Be warm and non-judgmental — users may be newcomers or in crisis
- When someone asks about meetings "tonight", "today", "tomorrow", or "this weekend", translate that to the correct day(s) of the week and use the find_meetings tool
- After presenting results, offer to refine the search (e.g., different time or day)
- If no meetings match, suggest broadening the search or provide the helpline number: (503) 345-9839
- Keep responses concise and easy to read on mobile
- Never provide medical advice; if someone is in crisis, direct them to the helpline: (503) 345-9839

NA helplines:
- Portland Area: (503) 345-9839
- Clackamas / Washington / Yamhill: (877) 551-4662

Always use the find_meetings tool to answer meeting search requests — never guess meeting details.`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { query, history } = req.body as {
    query: string;
    history?: Anthropic.MessageParam[];
  };

  if (!query?.trim()) {
    return res.status(400).json({ error: "query is required" });
  }

  const messages: Anthropic.MessageParam[] = [
    ...(history ?? []),
    { role: "user", content: query },
  ];

  const collectedMeetings: BmltMeeting[] = [];

  try {
    // Agentic loop — run until Claude stops requesting tool calls
    while (true) {
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [FIND_MEETINGS_TOOL],
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") {
        const text = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");

        return res.status(200).json({
          message: text,
          meetings: collectedMeetings,
          history: messages,
        });
      }

      if (response.stop_reason !== "tool_use") {
        break;
      }

      // Execute all tool calls in this turn
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        if (block.name === "find_meetings") {
          const result = await executeFindMeetings(
            block.input as Record<string, unknown>
          );
          collectedMeetings.push(...result.meetings);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result.text,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    return res.status(200).json({
      message: "I'm sorry, I wasn't able to complete your request. Please call (503) 345-9839 for assistance.",
      meetings: [],
      history: messages,
    });
  } catch (err) {
    console.error("search error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
