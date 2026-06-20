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
  const prompt = `You are ${bot.name}, hanging out watching a video with friends in a group chat.
Personality: ${bot.personalityPrompt.split('.')[0]}.

Video: "${context.title}", currently at ${context.timestamp} (${context.progressPct}% through).
${context.timeJumped ? 'The viewer just skipped/jumped to a different part of the video.' : ''}
What you said recently: ${context.ownRecentText}
What others said recently: ${context.othersRecentText}
You last spoke ${context.secondsSinceLastSpoke}s ago. You've stayed silent ${context.silenceStreak} times in a row.

Real people watching together do NOT comment constantly — most moments pass with no reaction at all.
Only SPEAK if there's a genuinely good, specific reason to right now (something funny/surprising/worth reacting to, or you're directly continuing a conversation). If in doubt, stay SILENT — silence is the normal, expected answer, not a failure.
Do not speak just because you haven't spoken in a while, and do not repeat or rephrase what you or someone else just said.

Reply with ONLY one word: SPEAK or SILENT`;

  const result = await callGeminiWithHardening({
    prompt,
    model: FAST_MODEL,
    maxTokens: 5
  });

  if (!result) return 'SILENT'; // graceful fail
  return result.toUpperCase().startsWith('SPEAK') ? 'SPEAK' : 'SILENT';
}

/**
 * Step 4 — Reaction generation call. Full personality, short creative output.
 */
async function generateReaction(bot, context) {
  const prompt = `You are ${bot.name}. ${bot.personalityPrompt}

You're watching "${context.title}" with friends in a group chat. You're at ${context.timestamp} (${context.progressPct}% through).
${context.timeJumped ? "The viewer just skipped to a different part — don't assume you know what's currently happening, react more generally or ask/comment about the jump itself." : ''}
What you said recently: ${context.ownRecentText}
What others said recently: ${context.othersRecentText}

Important: you can't actually see the video frame-by-frame, only its title and roughly where you are in it — so don't invent specific visual details you couldn't know. React the way a friend texting from another room would: general vibes, banter, reacting to what others said, not a play-by-play.
Max 2 sentences. Don't repeat what you or someone else just said. Feel real, not generic.`;

  const result = await callGeminiWithHardening({
    prompt,
    model: FAST_MODEL,
    maxTokens: 60
  });

  return result; // null if failed — caller treats as silent skip
}

/**
 * Fresh reaction grounded in a real, AI-marked speakable transcript window.
 * Generated live, at the moment the bot reacts — never a pre-written line.
 * Used when a real transcript is available; falls back to generateReaction()
 * when it's not (see agents.js).
 */
async function generateGroundedReaction(bot, context, transcriptSnippet, windowTag) {
  const prompt = `You are ${bot.name}. ${bot.personalityPrompt}

You're watching "${context.title}" with friends in a group chat, currently at ${context.timestamp}.
${context.timeJumped ? "The viewer just jumped/skipped to this exact part of the video — react to that too, like 'whoa you jumped right to this part' or similar, naturally." : ''}

What's actually happening right now in the video (real transcript, this moment is tagged "${windowTag}"):
"${transcriptSnippet}"

What you said recently: ${context.ownRecentText}
What others said recently: ${context.othersRecentText}

React fresh, right now, like you're actually watching this exact moment with friends — specific to what's really happening (you DO know this part, it's quoted above), not generic. Max 2 sentences. Feel real, not generic. Don't repeat what you or someone else just said.`;

  const result = await callGeminiWithHardening({
    prompt,
    model: FAST_MODEL,
    maxTokens: 70
  });

  return result; // null if failed — caller treats as silent skip
}

/**
 * Reply to a user message — same hardening pattern.
 */
async function decideReplyToUser(bot, userMessage, context) {
  const prompt = `You are ${bot.name}. Personality: ${bot.personalityPrompt.split('.')[0]}.
The user just said: "${userMessage}"

Given your personality, would you naturally jump in here? Not every message needs a reply from every friend — sometimes one or two people respond and others just let it pass. If this doesn't really call for your voice specifically, stay SILENT.

Reply with ONLY one word: SPEAK or SILENT`;

  const result = await callGeminiWithHardening({
    prompt,
    model: FAST_MODEL,
    maxTokens: 5
  });

  if (!result) return 'SILENT';
  return result.toUpperCase().startsWith('SPEAK') ? 'SPEAK' : 'SILENT';
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
