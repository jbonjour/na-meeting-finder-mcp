// na-meeting-finder frontend
// Talks to /api/search, maintains conversation history, supports voice input

const chatEl = document.getElementById("chat");
const queryEl = document.getElementById("query");
const sendBtn = document.getElementById("send-btn");
const micBtn = document.getElementById("mic-btn");
const suggestions = document.getElementById("suggestions");

let conversationHistory = [];
let isLoading = false;

// ── Auto-resize textarea ────────────────────────────────────────────
function resizeTextarea() {
  queryEl.style.height = "auto";
  queryEl.style.height = Math.min(queryEl.scrollHeight, 120) + "px";
}

queryEl.addEventListener("input", () => {
  resizeTextarea();
  sendBtn.disabled = !queryEl.value.trim() || isLoading;
});

queryEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) submitQuery();
  }
});

// ── Suggestion chips ───────────────────────────────────────────────
suggestions.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  queryEl.value = chip.dataset.query;
  resizeTextarea();
  sendBtn.disabled = false;
  submitQuery();
});

// ── Send button ────────────────────────────────────────────────────
sendBtn.addEventListener("click", submitQuery);

// ── Markdown-lite renderer ─────────────────────────────────────────
function renderMarkdown(text) {
  // Bold
  text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  // Italic (but not emoji underscore)
  text = text.replace(/(?<!\w)_(.*?)_(?!\w)/g, "<em>$1</em>");
  // Inline code
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Links
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Phone numbers → tel links
  text = text.replace(/\((\d{3})\)\s*(\d{3})-(\d{4})/g, '<a href="tel:+1$1$2$3">($1) $2-$3</a>');
  // Paragraphs (double newline)
  const paras = text.split(/\n\n+/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`);
  return paras.join("");
}

// ── Append a message bubble ────────────────────────────────────────
function appendMessage(role, html) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = html;
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
  return div;
}

// ── Typing indicator ───────────────────────────────────────────────
function showTyping() {
  const div = document.createElement("div");
  div.className = "msg bot typing-dots";
  div.id = "typing";
  div.innerHTML = "<span></span><span></span><span></span>";
  chatEl.appendChild(div);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function hideTyping() {
  document.getElementById("typing")?.remove();
}

// ── Main submit ────────────────────────────────────────────────────
async function submitQuery() {
  const text = queryEl.value.trim();
  if (!text || isLoading) return;

  // Hide chips after first message
  suggestions.style.display = "none";

  appendMessage("user", escapeHtml(text));
  queryEl.value = "";
  resizeTextarea();
  sendBtn.disabled = true;
  isLoading = true;
  showTyping();

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: text, history: conversationHistory }),
    });

    hideTyping();

    if (!res.ok) {
      appendMessage("bot", "<p>Sorry, something went wrong. Please try again or call <a href='tel:+15033459839'>(503) 345-9839</a>.</p>");
      isLoading = false;
      return;
    }

    const data = await res.json();
    conversationHistory = data.history ?? conversationHistory;

    appendMessage("bot", renderMarkdown(data.message));
  } catch {
    hideTyping();
    appendMessage("bot", "<p>Unable to connect. Please check your connection or call <a href='tel:+15033459839'>(503) 345-9839</a>.</p>");
  }

  isLoading = false;
  sendBtn.disabled = !queryEl.value.trim();
  queryEl.focus();
}

// ── HTML escaping ──────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Voice input (Web Speech API) ───────────────────────────────────
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SpeechRecognition) {
  micBtn.style.display = "none";
} else {
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = "en-US";

  let listening = false;

  micBtn.addEventListener("click", () => {
    if (listening) {
      recognition.stop();
    } else {
      recognition.start();
    }
  });

  recognition.onstart = () => {
    listening = true;
    micBtn.classList.add("listening");
    micBtn.setAttribute("aria-label", "Stop listening");
  };

  recognition.onend = () => {
    listening = false;
    micBtn.classList.remove("listening");
    micBtn.setAttribute("aria-label", "Voice input");
  };

  recognition.onerror = (e) => {
    console.warn("Speech error:", e.error);
    listening = false;
    micBtn.classList.remove("listening");
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript.trim();
    if (transcript) {
      queryEl.value = transcript;
      resizeTextarea();
      sendBtn.disabled = false;
      submitQuery();
    }
  };
}

// ── Welcome message ────────────────────────────────────────────────
appendMessage(
  "bot",
  "<p>Hi! I can help you find NA meetings in the Portland metro area.</p>" +
  "<p>Try asking something like <em>\"Are there any meetings tonight?\"</em> or <em>\"Open meetings on Saturday morning.\"</em></p>"
);
