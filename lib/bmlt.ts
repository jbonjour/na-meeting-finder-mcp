const ROOT_SERVER = "https://bmlt.wszf.org/main_server";
const SEMANTIC_PATH = "/client_interface/json/";

// Portland-area service body IDs
const SERVICE_BODY_IDS = [39, 29, 44, 46]; // Portland Area, Clackamas, Washington County, Yamhill

export interface BmltMeeting {
  id_bigint: string;
  meeting_name: string;
  weekday_tinyint: string; // "1"=Sun … "7"=Sat
  start_time: string; // "HH:MM:SS"
  duration_time: string;
  location_text: string;
  location_street: string;
  location_city_subsection: string;
  location_municipality: string;
  location_province: string;
  location_postal_code_1: string;
  location_info: string;
  comments: string;
  formats: string; // comma-separated format keys
  longitude: string;
  latitude: string;
  service_body_bigint: string;
  [key: string]: string;
}

export interface BmltFormat {
  key_string: string;
  name_string: string;
  description_string: string;
  lang: string;
  id: string;
}

export interface SearchOptions {
  weekdays?: number[];       // 1=Sun … 7=Sat
  formats?: string[];        // format key strings like "O", "BT"
  meetingName?: string;
  startTimeMin?: string;     // "HH:MM"
  startTimeMax?: string;
  latitude?: number;
  longitude?: number;
  radiusMiles?: number;
}

const WEEKDAY_NAMES: Record<number, string> = {
  1: "Sunday", 2: "Monday", 3: "Tuesday", 4: "Wednesday",
  5: "Thursday", 6: "Friday", 7: "Saturday",
};

function formatTime(raw: string): string {
  const [hStr, mStr] = raw.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr.padStart(2, "0");
  const period = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${period}`;
}

async function bmltFetch<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`BMLT HTTP ${res.status}`);
    let text = await res.text();
    // Strip JSONP wrapper if present
    text = text.replace(/^[^([{]*\(/, "").replace(/\);?\s*$/, "");
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchMeetings(options: SearchOptions = {}): Promise<BmltMeeting[]> {
  const params = new URLSearchParams();
  params.set("switcher", "GetSearchResults");
  params.set("get_used_formats", "0");

  for (const id of SERVICE_BODY_IDS) {
    params.append("services[]", String(id));
  }

  if (options.weekdays?.length) {
    for (const d of options.weekdays) params.append("weekdays[]", String(d));
  }

  if (options.meetingName) {
    params.set("meeting_key", "meeting_name");
    params.set("meeting_key_value", options.meetingName);
  }

  if (options.startTimeMin) params.set("StartsAfter", options.startTimeMin);
  if (options.startTimeMax) params.set("StartsBefore", options.startTimeMax);

  if (options.latitude != null && options.longitude != null && options.radiusMiles != null) {
    params.set("lat_val", String(options.latitude));
    params.set("long_val", String(options.longitude));
    params.set("geo_width_km", String(options.radiusMiles * 1.60934));
  }

  const url = `${ROOT_SERVER}${SEMANTIC_PATH}?${params.toString()}`;
  const raw = await bmltFetch<BmltMeeting[]>(url);
  return Array.isArray(raw) ? raw : [];
}

export async function getFormats(): Promise<BmltFormat[]> {
  const params = new URLSearchParams({ switcher: "GetFormats" });
  const url = `${ROOT_SERVER}${SEMANTIC_PATH}?${params.toString()}`;
  const raw = await bmltFetch<{ formats: BmltFormat[] }>(url);
  return raw?.formats ?? [];
}

export function formatMeeting(m: BmltMeeting, formatMap: Record<string, string>): string {
  const day = WEEKDAY_NAMES[parseInt(m.weekday_tinyint, 10)] ?? "Unknown";
  const time = formatTime(m.start_time);
  const address = [
    m.location_text,
    m.location_street,
    m.location_city_subsection || m.location_municipality,
  ]
    .filter(Boolean)
    .join(", ");
  const fmtNames = m.formats
    ? m.formats
        .split(",")
        .map((k) => formatMap[k.trim()] ?? k.trim())
        .filter(Boolean)
        .join(", ")
    : "";
  const notes = [m.location_info, m.comments].filter(Boolean).join(" | ");

  return [
    `**${m.meeting_name}**`,
    `📅 ${day} at ${time}`,
    `📍 ${address}`,
    fmtNames ? `🏷️ ${fmtNames}` : null,
    notes ? `💬 ${notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
