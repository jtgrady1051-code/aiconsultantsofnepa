// api/assess.js — Vercel serverless function that runs Jamie.
//
// WHY THIS FILE EXISTS (the one concept that matters):
// Your Anthropic API key must never reach the browser. Anything in frontend
// JavaScript can be read by any visitor with View Source. So the browser talks
// to THIS function, and this function — running on Vercel's servers, where the
// key lives as an environment variable — talks to Claude. The key never leaves
// the server.
//
// The frontend (Phase 3) will POST here:
//   { "messages": [ { "role": "user", "content": "..." }, ... ] }
// and get back:
//   { "reply": "Jamie's next message" }

const SYSTEM_PROMPT = require("./_prompt.js");

// --- Abuse limits (cheap insurance against bots running up your bill) ---
const MAX_MESSAGES = 60;   // a real assessment finishes in ~20-30 turns
const MAX_CHARS = 2000;    // per message — nobody types more than this honestly
const MODEL = "claude-haiku-4-5-20251001"; // fast + cheap; ~1-2 cents per full assessment

// Origins allowed to call this API from the browser (CORS). The site lives on
// aiconsultantsofnepa.com; the vercel.app patterns cover our own preview URLs.
const ALLOWED_ORIGIN = /^https:\/\/(www\.)?aiconsultantsofnepa\.com$|^https:\/\/(jamie-intake|aiconsultantsofnepa)[a-z0-9-]*(-jtgrady1051-codes-projects)?\.vercel\.app$/;

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGIN.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Misconfiguration on our side — never expose details to the visitor.
    console.error("ANTHROPIC_API_KEY is not set in Vercel environment variables");
    return res.status(500).json({ error: "Server not configured" });
  }

  // --- Validate the request. Never trust input from a browser. ---
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Bad request" });
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(400).json({ error: "Conversation limit reached" });
  }
  for (const m of messages) {
    const roleOk = m && (m.role === "user" || m.role === "assistant");
    const contentOk = typeof m?.content === "string" && m.content.length > 0 && m.content.length <= MAX_CHARS;
    if (!roleOk || !contentOk) {
      return res.status(400).json({ error: "Bad request" });
    }
  }

  // --- Call Claude ---
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: messages.map((m) => ({ role: m.role, conten