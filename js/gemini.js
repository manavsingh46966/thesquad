// ============================================
// AI API LAYER — NEAR AI Cloud, OpenAI-compatible (hardened per workflow doc)
// ============================================

const GEMINI_TIMEOUT_MS = 4000;
const GEMINI_ENDPOINT = '/.netlify/functions/gemini'; // proxied through serverless function, key never exposed

// Two-tier model strategy:
// FAST_MODEL  — high-frequency, low-stakes calls (decisions, reactions, replies). Cheapest, no reasoning overhead.
// QUALITY_MODEL — rare, one-off calls where better writing is worth the small extra cost.
const FAST_MODEL = 'openai/gpt-4.1-nano';
const QUALITY_MODEL = 'openai/gpt-4.1-mini';

/**
 * Generic fetch wrapper with timeout + single retry.
 * On any failure after retry, resolves to null (caller treats null as SILENT / skip).
 */
async function callGeminiWithHardening(payload, attempt = 1) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`Gemini call failed: ${res.status}`);
    const data = await res.json();
    return data.text ? data.text.trim() : null;
  } catch (err) {
    clearTimeout(timeoutId);
    if (attempt === 1) {
      // Fix 4: retry once
      return callGeminiWithHardening(payload, 2);
    }
    // Fix 2: graceful fail — caller treats null as SILENT
    console.warn('Gemini call failed after retry:', err.message);
    if (typeof trackEvent === 'function') {
      trackEvent('bot_call_failed', { reason: err.message, attempt });
    }
    return null;
  }
}

/**
 * Step 2 — Decision call. Fast, cheap, 1-word response.
 * Fix 1: short prompt, capped output, lightweight model.
 */
async function decideSpeakOrSilent(bot, context) {
  const prompt = `You are ${bot.name}. Personality: ${bot.personalityPrompt.split('.')[0]}.
Video: "${context.title}" at ${context.progressPct}% progress.
Recent chat: ${context.recentMessages.slice(-3).map(m => `${m.sender}: ${m.text}`).join(' | ') || '(nothing yet)'}
You last spoke ${context.secondsSinceLastSpoke}s ago.
Reply with ONLY one word: SPEAK or SILENT`;

  const result = await callGeminiWithHardening({
    prompt,
    model: FAST_MODEL,
    maxTokens: 5
  });

  if (!result) return 'SILENT'; // graceful fail
  return result.toUpperCase().includes('SPEAK') ? 'SPEAK' : 'SILENT';
}

/**
 * Step 4 — Reaction generation call. Full personality, short creative output.
 */
async function generateReaction(bot, context) {
  const prompt = `You are ${bot.name}. ${bot.personalityPrompt}

Video: "${context.title}" — currently at ${context.timestamp} (${context.progressPct}% through)
Recent chat: ${context.recentMessages.slice(-3).map(m => `${m.sender}: ${m.text}`).join(' | ') || '(nothing yet)'}
You haven't spoken in ${context.secondsSinceLastSpoke} seconds.

React to this moment in character. Be specific to what's happening. Max 2 sentences. Feel real.`;

  const result = await callGeminiWithHardening({
    prompt,
    model: FAST_MODEL,
    maxTokens: 60
  });

  return result; // null if failed — caller treats as silent skip
}

/**
 * Reply to a user message — same hardening pattern.
 */
async function decideReplyToUser(bot, userMessage, context) {
  const prompt = `You are ${bot.name}. Personality: ${bot.personalityPrompt.split('.')[0]}.
The user just said: "${userMessage}"
Given your personality, do you reply? Reply with ONLY one word: SPEAK or SILENT`;

  const result = await callGeminiWithHardening({
    prompt,
    model: FAST_MODEL,
    maxTokens: 5
  });

  if (!result) return 'SILENT';
  return result.toUpperCase().includes('SPEAK') ? 'SPEAK' : 'SILENT';
}

async function generateReplyToUser(bot, userMessage, context) {
  const prompt = `You are ${bot.name}. ${bot.personalityPrompt}

User just said: "${userMessage}"
Video context: "${context.title}" at ${context.progressPct}%
Recent chat: ${context.recentMessages.slice(-3).map(m => `${m.sender}: ${m.text}`).join(' | ')}

Reply in character. Max 2-3 sentences.`;

  const result = await callGeminiWithHardening({
    prompt,
    model: FAST_MODEL,
    maxTokens: 80
  });

  return result;
}

/**
 * Custom bot creation — turns a free-text description into a full personality prompt.
 */
async function createCustomBotPersonality(name, description) {
  const prompt = `Given this personality description of a friend: "${description}"

Write a detailed AI personality prompt (3-4 sentences) that captures how this person would text,
react, and engage while watching videos with a friend. The prompt should instruct the AI to:
- Text casually (lowercase, real texting style, appropriate emojis)
- Have a clear distinct voice based on the description
- Never sound formal or robotic
- Keep responses short (1-2 sentences typically)

Write ONLY the personality prompt itself, nothing else.`;

  const result = await callGeminiWithHardening({
    prompt,
    model: QUALITY_MODEL,
    maxTokens: 200
  });

  if (!result) {
    throw new Error('Could not generate personality. Please try again.');
  }
  return result;
}

/**
 * Admin: analyze real Novus segment data and suggest improvements.
 */
async function generateAdminSuggestions(segmentData) {
  const prompt = `Here is real user behavior data from our app:

${JSON.stringify(segmentData, null, 2)}

Based on this data, suggest:
1. Specific personality improvements for each bot to better serve the segment that loves them
2. What might be causing drop-off in the lowest-engagement segment
3. One new feature that would serve the most analytical/engaged segment

Be specific and actionable. Respond with ONLY valid JSON in this format:
{"bot_improvements": {"botname": ["suggestion1", "suggestion2"]}, "dropoff_diagnosis": "...", "new_feature": "..."}`;

  const result = await callGeminiWithHardening({
    prompt,
    model: QUALITY_MODEL,
    maxTokens: 500
  });

  if (!result) return null;
  try {
    const cleaned = result.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn('Could not parse admin suggestions JSON', e);
    return null;
  }
}
