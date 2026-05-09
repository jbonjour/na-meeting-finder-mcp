import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { BmltMeeting, BmltFormat } from "../../lib/bmlt.js";

// ── Hoist mock references before vi.mock factories run ────────────────────────

const mockCreate = vi.hoisted(() => vi.fn());
const mockSearchMeetings = vi.hoisted(() => vi.fn());
const mockGetFormats = vi.hoisted(() => vi.fn());
const mockFormatMeeting = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockReturnValue({
    messages: { create: mockCreate },
  }),
}));

vi.mock("../../lib/bmlt.js", () => ({
  searchMeetings: mockSearchMeetings,
  getFormats: mockGetFormats,
  formatMeeting: mockFormatMeeting,
}));

// Import handler after mocks are in place
import handler from "../../api/search.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_MEETING: BmltMeeting = {
  id_bigint: "12345",
  meeting_name: "Clean & Serene",
  weekday_tinyint: "2", // Monday
  start_time: "19:00:00",
  duration_time: "01:30:00",
  location_text: "Alano Club of Portland",
  location_street: "909 NW 24th Ave",
  location_city_subsection: "Northwest",
  location_municipality: "Portland",
  location_province: "OR",
  location_postal_code_1: "97210",
  location_info: "",
  comments: "",
  formats: "O",
  longitude: "-122.6937",
  latitude: "45.5290",
  service_body_bigint: "39",
};

const MOCK_FORMATS: BmltFormat[] = [
  { key_string: "O", name_string: "Open", description_string: "", lang: "en", id: "1" },
];

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeReq(body: object, method = "POST"): VercelRequest {
  return { method, body } as unknown as VercelRequest;
}

function makeRes() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
    end: vi.fn(),
  };
  // Allow chaining: res.status(200).json({...})
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  res.end.mockReturnValue(res);
  return res as unknown as VercelResponse & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

// ── Method / validation guards ────────────────────────────────────────────────

describe("handler — method and input validation", () => {
  it("returns 200 for OPTIONS (preflight)", async () => {
    const req = makeReq({}, "OPTIONS");
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 405 for GET requests", async () => {
    const req = makeReq({}, "GET");
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it("returns 400 when query is missing", async () => {
    const req = makeReq({});
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when query is empty string", async () => {
    const req = makeReq({ query: "   " });
    const res = makeRes();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ── Happy path: tool use → end_turn ──────────────────────────────────────────

describe("handler — happy path (tool use + end turn)", () => {
  beforeEach(() => {
    mockGetFormats.mockResolvedValue(MOCK_FORMATS);
    mockSearchMeetings.mockResolvedValue([MOCK_MEETING]);
    mockFormatMeeting.mockReturnValue("**Clean & Serene**\n📅 Monday at 7:00 PM");

    // Round 1: Claude calls find_meetings tool
    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "toolu_01",
          name: "find_meetings",
          input: { weekdays: [2] },
        },
      ],
    });

    // Round 2: Claude returns final text after seeing tool results
    mockCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Here is a meeting tonight:\n\n**Clean & Serene** — Monday 7:00 PM at Alano Club.",
        },
      ],
    });
  });

  it("returns 200 with message and meetings", async () => {
    const req = makeReq({ query: "meetings tonight" });
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.message).toContain("Clean & Serene");
    expect(payload.meetings).toHaveLength(1);
    expect(payload.meetings[0].meeting_name).toBe("Clean & Serene");
  });

  it("includes conversation history in response", async () => {
    const req = makeReq({ query: "meetings tonight" });
    const res = makeRes();
    await handler(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(Array.isArray(payload.history)).toBe(true);
    expect(payload.history.length).toBeGreaterThan(0);
  });

  it("calls Claude twice — once to get tool call, once after results", async () => {
    const req = makeReq({ query: "meetings tonight" });
    const res = makeRes();
    await handler(req, res);

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("calls searchMeetings and getFormats when tool fires", async () => {
    const req = makeReq({ query: "meetings tonight" });
    const res = makeRes();
    await handler(req, res);

    expect(mockSearchMeetings).toHaveBeenCalledOnce();
    expect(mockGetFormats).toHaveBeenCalledOnce();
  });

  it("passes weekdays from tool input to searchMeetings", async () => {
    const req = makeReq({ query: "meetings tonight" });
    const res = makeRes();
    await handler(req, res);

    expect(mockSearchMeetings).toHaveBeenCalledWith(
      expect.objectContaining({ weekdays: [2] })
    );
  });

  it("appends prior history to messages sent to Claude", async () => {
    const priorHistory = [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
    ];
    const req = makeReq({ query: "meetings tonight", history: priorHistory });
    const res = makeRes();
    await handler(req, res);

    const firstCallMessages = mockCreate.mock.calls[0][0].messages;
    expect(firstCallMessages[0]).toEqual(priorHistory[0]);
    expect(firstCallMessages[1]).toEqual(priorHistory[1]);
  });
});

// ── No results path ───────────────────────────────────────────────────────────

describe("handler — no results", () => {
  it("returns message indicating no meetings found", async () => {
    mockGetFormats.mockResolvedValue([]);
    mockSearchMeetings.mockResolvedValue([]);

    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "toolu_01", name: "find_meetings", input: {} }],
    });

    mockCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "I couldn't find any meetings. Try the helpline: (503) 345-9839" }],
    });

    const req = makeReq({ query: "meetings at 3am" });
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.meetings).toHaveLength(0);
    expect(payload.message).toContain("345-9839");
  });
});

// ── Direct end_turn (no tool call) ───────────────────────────────────────────

describe("handler — Claude answers without calling a tool", () => {
  it("returns 200 with text message and empty meetings", async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "NA stands for Narcotics Anonymous." }],
    });

    const req = makeReq({ query: "what is NA?" });
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.message).toBe("NA stands for Narcotics Anonymous.");
    expect(payload.meetings).toHaveLength(0);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("handler — error handling", () => {
  it("returns 500 when Claude API throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Network error"));

    const req = makeReq({ query: "meetings tonight" });
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error).toBeDefined();
  });

  it("returns 500 when BMLT fetch throws during tool execution", async () => {
    mockGetFormats.mockRejectedValueOnce(new Error("BMLT unreachable"));
    mockSearchMeetings.mockRejectedValueOnce(new Error("BMLT unreachable"));

    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "toolu_01", name: "find_meetings", input: {} }],
    });

    const req = makeReq({ query: "meetings tonight" });
    const res = makeRes();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
