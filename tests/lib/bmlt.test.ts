import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  searchMeetings,
  getFormats,
  formatMeeting,
  type BmltMeeting,
  type BmltFormat,
} from "../../lib/bmlt.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_MEETING: BmltMeeting = {
  id_bigint: "12345",
  meeting_name: "Clean & Serene",
  weekday_tinyint: "3", // Tuesday
  start_time: "19:00:00",
  duration_time: "01:30:00",
  location_text: "Alano Club of Portland",
  location_street: "909 NW 24th Ave",
  location_city_subsection: "Northwest",
  location_municipality: "Portland",
  location_province: "OR",
  location_postal_code_1: "97210",
  location_info: "Enter through side door",
  comments: "Chip meeting on 1st Tuesday",
  formats: "O,BT",
  longitude: "-122.6937",
  latitude: "45.5290",
  service_body_bigint: "39",
};

const FORMAT_MAP = { O: "Open", BT: "Basic Text" };

const MOCK_FORMATS: BmltFormat[] = [
  { key_string: "O", name_string: "Open", description_string: "Open to all", lang: "en", id: "1" },
  { key_string: "BT", name_string: "Basic Text", description_string: "Basic Text study", lang: "en", id: "2" },
];

// ── formatMeeting ─────────────────────────────────────────────────────────────

describe("formatMeeting", () => {
  it("includes meeting name, day, time, and address", () => {
    const result = formatMeeting(MOCK_MEETING, FORMAT_MAP);
    expect(result).toContain("Clean & Serene");
    expect(result).toContain("Tuesday");
    expect(result).toContain("7:00 PM");
    expect(result).toContain("Alano Club of Portland");
    expect(result).toContain("909 NW 24th Ave");
  });

  it("includes mapped format names", () => {
    const result = formatMeeting(MOCK_MEETING, FORMAT_MAP);
    expect(result).toContain("Open");
    expect(result).toContain("Basic Text");
  });

  it("includes location_info and comments as notes", () => {
    const result = formatMeeting(MOCK_MEETING, FORMAT_MAP);
    expect(result).toContain("Enter through side door");
  });

  it("omits notes line when location_info and comments are both empty", () => {
    const m: BmltMeeting = { ...MOCK_MEETING, location_info: "", comments: "" };
    const result = formatMeeting(m, FORMAT_MAP);
    expect(result).not.toContain("💬");
  });

  it("omits formats line when formats field is empty", () => {
    const m: BmltMeeting = { ...MOCK_MEETING, formats: "" };
    const result = formatMeeting(m, FORMAT_MAP);
    expect(result).not.toContain("🏷️");
  });

  it("converts 12:00:00 to 12:00 PM", () => {
    const noon: BmltMeeting = { ...MOCK_MEETING, start_time: "12:00:00" };
    expect(formatMeeting(noon, {})).toContain("12:00 PM");
  });

  it("converts 00:00:00 to 12:00 AM", () => {
    const midnight: BmltMeeting = { ...MOCK_MEETING, start_time: "00:00:00" };
    expect(formatMeeting(midnight, {})).toContain("12:00 AM");
  });

  it("converts 13:30:00 to 1:30 PM", () => {
    const afternoon: BmltMeeting = { ...MOCK_MEETING, start_time: "13:30:00" };
    expect(formatMeeting(afternoon, {})).toContain("1:30 PM");
  });

  it("renders Sunday (weekday 1) correctly", () => {
    const sunday: BmltMeeting = { ...MOCK_MEETING, weekday_tinyint: "1" };
    expect(formatMeeting(sunday, {})).toContain("Sunday");
  });

  it("renders Saturday (weekday 7) correctly", () => {
    const saturday: BmltMeeting = { ...MOCK_MEETING, weekday_tinyint: "7" };
    expect(formatMeeting(saturday, {})).toContain("Saturday");
  });
});

// ── searchMeetings ────────────────────────────────────────────────────────────

describe("searchMeetings", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns meetings from BMLT API", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify([MOCK_MEETING]),
    } as Response);

    const results = await searchMeetings({});
    expect(results).toHaveLength(1);
    expect(results[0].meeting_name).toBe("Clean & Serene");
  });

  it("includes all four Portland-area service bodies in the request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify([]),
    } as Response);

    await searchMeetings({});

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("services%5B%5D=39"); // Portland Area
    expect(url).toContain("services%5B%5D=29"); // Clackamas
    expect(url).toContain("services%5B%5D=44"); // Washington County
    expect(url).toContain("services%5B%5D=46"); // Yamhill
  });

  it("appends weekday params when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify([]),
    } as Response);

    await searchMeetings({ weekdays: [3, 5] }); // Tue, Thu

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("weekdays%5B%5D=3");
    expect(url).toContain("weekdays%5B%5D=5");
  });

  it("appends start time params when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify([]),
    } as Response);

    await searchMeetings({ startTimeMin: "18:00", startTimeMax: "21:00" });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("StartsAfter=18%3A00");
    expect(url).toContain("StartsBefore=21%3A00");
  });

  it("returns empty array when BMLT returns a non-array", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ error: "no results" }),
    } as Response);

    const results = await searchMeetings({});
    expect(results).toEqual([]);
  });

  it("strips JSONP wrapper from response if present", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => `callback(${JSON.stringify([MOCK_MEETING])});`,
    } as Response);

    const results = await searchMeetings({});
    expect(results).toHaveLength(1);
  });

  it("throws on non-ok HTTP response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    } as Response);

    await expect(searchMeetings({})).rejects.toThrow("BMLT HTTP 503");
  });
});

// ── getFormats ────────────────────────────────────────────────────────────────

describe("getFormats", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns formats array from BMLT API", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ formats: MOCK_FORMATS }),
    } as Response);

    const formats = await getFormats();
    expect(formats).toHaveLength(2);
    expect(formats[0].key_string).toBe("O");
    expect(formats[1].key_string).toBe("BT");
  });

  it("returns empty array when formats key is missing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({}),
    } as Response);

    const formats = await getFormats();
    expect(formats).toEqual([]);
  });
});
