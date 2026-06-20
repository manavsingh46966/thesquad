// ============================================
// TRANSCRIPT MODULE
// ============================================
// Architecture (per design discussion):
// 1. PRE-PROCESS (once, on video load): fetch the real transcript, send it to the AI
//    in ONE shot, ask it to mark which timestamp ranges are "speakable" (interesting/
//    emotional/funny beats) and why. We are NOT asking for reaction text here — only
//    which moments deserve a reaction, decided once from real content.
// 2. RUNTIME (every few seconds, cheap, no AI call): check if the current playback
//    time falls inside a marked window. If yes -> generate a FRESH reaction right now,
//    grounded in that window's actual transcript snippet. If no -> stay silent, no
//    decision call needed at all.
//
// Graceful degradation: if no transcript exists for this video (private captions,
// no captions at all, fetch failure, rate limit on the free source), transcriptAvailable
// stays false and agents.js falls back to the old vibes-based blind decision loop.

const TRANSCRIPT_SOURCE = (videoId) => `https://youtube-transcript.ai/transcript/${videoId}.txt`;
const TRANSCRIPT_FETCH_TIMEOUT_MS = 8000;
const WINDOW_MATCH_BUFFER_SEC = 3; // small grace window so we don't miss a beat by a couple seconds

let transcriptAvailable = false;
let transcriptEntries = []; // [{time: seconds, text: string}]
let speakableWindows = [];  // [{start, end, tag}]
let transcriptInitInProgress = false;

/**
 * Parses raw "[m:ss] text" or "[h:mm:ss] text" formatted transcript text
 * into a flat list of {time, text} entries.
 */
function parseTranscriptText(raw) {
  const entries = [];
  const regex = /\[(\d+):(\d+)(?::(\d+))?\]\s*([^\[]*)/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    let time;
    if (match[3] !== undefined) {
      // h:mm:ss
      time = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
    } else {
      // m:ss
      time = parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
    }
    const text = match[4].replace(/\s+/g, ' ').trim();
    if (text) entries.push({ time, text });
  }
  return entries;
}

async function fetchRawTranscript(videoId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(TRANSCRIPT_SOURCE(videoId), { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trim().length < 20) return null; // too short to be a real transcript
    return text;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('Transcript fetch failed:', err.message);
    return null;
  }
}

/**
 * Builds a compact, timestamped version of the transcript to send to the AI
 * for window-marking. Caps length so we don't blow context/token budget on
 * long videos — for a hackathon demo this favors trailers/shorter clips, but
 * degrades gracefully (just analyzes the first chunk) rather than failing.
 */
function buildTranscriptPromptBlock(entries) {
  const MAX_CHARS = 12000;
  let block = '';
  for (const entry of entries) {
    const line = `[${formatMMSS(entry.time)}] ${entry.text}\n`;
    if (block.length + line.length > MAX_CHARS) break;
    block += line;
  }
  return block;
}

function formatMMSS(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Sends the whole transcript to the AI ONCE, asks it to mark speakable windows.
 * Returns a parsed array of {start, end, tag} or null on failure.
 */
async function markSpeakableWindows(entries, title) {
  const transcriptBlock = buildTranscriptPromptBlock(entries);

  const prompt = `Here is a timestamped transcript of a video titled "${title}":

${transcriptBlock}

Identify the moments in this transcript that would make a friend watching along want to react out loud — twists, reveals, jokes, emotional beats, surprises, intense moments. Most of the video should NOT be marked; only genuinely reaction-worthy beats.

For each one, give a short timestamp window (a few seconds wide, centered on the moment) and a short tag describing what happens (e.g. "MJ reveal", "villain entrance", "punchline").

Respond with ONLY valid JSON, no other text, in this exact format:
[{"start": 12, "end": 18, "tag": "short description"}, ...]

Use numeric seconds for start/end (not mm:ss strings). If genuinely nothing stands out, respond with [].`;

  const result = await callGeminiWithHardening({
    prompt,
    model: QUALITY_MODEL,
    maxTokens: 800
  });

  if (!result) return null;

  try {
    const cleaned = result.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (w) => typeof w.start === 'number' && typeof w.end === 'number' && w.end >= w.start
    );
  } catch (e) {
    console.warn('Could not parse speakable windows JSON', e);
    return null;
  }
}

/**
 * Main entry point — call once when a video loads. Fetches transcript,
 * marks windows, stores results in module state. Fully non-blocking failure:
 * if anything goes wrong, transcriptAvailable stays false and callers should
 * fall back to the existing vibes-based logic.
 */
async function initTranscriptForVideo(videoId, title) {
  transcriptAvailable = false;
  transcriptEntries = [];
  speakableWindows = [];
  transcriptInitInProgress = true;

  try {
    const raw = await fetchRawTranscript(videoId);
    if (!raw) {
      console.warn('No transcript available for this video — falling back to vibes-based reactions.');
      return;
    }

    const entries = parseTranscriptText(raw);
    if (entries.length === 0) {
      console.warn('Transcript fetched but could not be parsed — falling back.');
      return;
    }

    const windows = await markSpeakableWindows(entries, title);
    if (!windows) {
      console.warn('Could not mark speakable windows — falling back.');
      return;
    }

    transcriptEntries = entries;
    speakableWindows = windows;
    transcriptAvailable = windows.length > 0;

    if (transcriptAvailable) {
      console.log(`Transcript ready: ${windows.length} speakable moment(s) marked.`, windows);
    } else {
      console.log('Transcript parsed but no speakable moments were marked.');
    }
  } finally {
    transcriptInitInProgress = false;
  }
}

/**
 * Cheap, no-AI lookup: is the given playback time inside (or just past) a
 * marked speakable window? Returns the window object (with a stable key) or null.
 */
function getSpeakableWindowAt(currentTime) {
  if (!transcriptAvailable) return null;
  for (const w of speakableWindows) {
    if (currentTime >= w.start - WINDOW_MATCH_BUFFER_SEC && currentTime <= w.end + WINDOW_MATCH_BUFFER_SEC) {
      return { ...w, key: `${w.start}-${w.end}` };
    }
  }
  return null;
}

/**
 * Returns the actual transcript text spoken during a given window, to ground
 * the AI's fresh reaction in what's really being said at that point.
 */
function getTranscriptSnippetForWindow(window) {
  if (!window) return '';
  const lines = transcriptEntries
    .filter((e) => e.time >= window.start - 5 && e.time <= window.end + 5)
    .map((e) => e.text);
  return lines.join(' ');
}
