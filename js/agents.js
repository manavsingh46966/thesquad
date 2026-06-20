// ============================================
// AGENTIC LOOP — staggered, hardened, per-bot
// ============================================

const TICK_INTERVAL_MS = 25000; // 25s base interval — fewer, more considered chances to speak
const MIN_COOLDOWN_MS = 35000; // hard floor: a bot cannot speak again within 35s of its last message, regardless of AI decision
const TRANSCRIPT_CHECK_INTERVAL_MS = 4000; // cheap, no-AI check — how often we look for a speakable window
const agentStates = {}; // botId -> AgentState
const activeIntervals = {}; // botId -> interval handle
let transcriptWatcherInterval = null;
let chatLog = []; // shared chat history: {sender, text, timestamp}
let videoContext = { title: '', videoId: '', currentTime: 0, duration: 1, isPlaying: false };

function initAgentState(bot) {
  agentStates[bot.id] = {
    lastSpokenAt: null,
    recentMessages: [],
    silenceStreak: 0,
    personalityPrompt: bot.personalityPrompt,
    lastReactedWindowKey: null // tracks which marked transcript window this bot last reacted to
  };
}

function getProgressPct() {
  if (!videoContext.duration) return 0;
  return Math.round((videoContext.currentTime / videoContext.duration) * 100);
}

function formatTimestamp(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function buildContext(bot) {
  const state = agentStates[bot.id];
  const secondsSinceLastSpoke = state.lastSpokenAt
    ? Math.round((Date.now() - state.lastSpokenAt) / 1000)
    : 9999;

  // Detect a time jump (user scrubbed forward/back) so bots know their last
  // sense of "where we are" may be stale, instead of reacting as if no time passed.
  const lastTime = state.lastSeenVideoTime ?? videoContext.currentTime;
  const timeJumped = Math.abs(videoContext.currentTime - lastTime) > 20;
  state.lastSeenVideoTime = videoContext.currentTime;

  const allRecent = chatLog.slice(-6);
  const ownRecent = allRecent.filter((m) => m.sender === bot.name).slice(-2);
  const othersRecent = allRecent.filter((m) => m.sender !== bot.name).slice(-3);

  return {
    title: videoContext.title,
    timestamp: formatTimestamp(videoContext.currentTime),
    progressPct: getProgressPct(),
    recentMessages: allRecent, // kept for back-compat in reply prompts
    ownRecentText: ownRecent.map((m) => m.text).join(' | ') || '(nothing yet)',
    othersRecentText: othersRecent.map((m) => `${m.sender}: ${m.text}`).join(' | ') || '(nothing yet)',
    secondsSinceLastSpoke,
    silenceStreak: state.silenceStreak || 0,
    timeJumped
  };
}

/**
 * Single tick for one bot: decide, maybe react, update state, track.
 */
async function runAgentTick(bot) {
  if (!videoContext.isPlaying) return; // don't tick while paused

  // If a real transcript was successfully marked for this video, the transcript
  // watcher (checkTranscriptWindowsTick) owns all reaction decisions — grounded,
  // content-aware, fires only at real marked beats. The old blind SPEAK/SILENT
  // loop steps aside entirely rather than double-reacting alongside it.
  if (transcriptAvailable) return;

  const state = agentStates[bot.id];
  // Hard floor: don't even ask the model if we're still inside the cooldown window.
  // Saves a call AND guarantees bots can never machine-gun messages regardless of AI judgment.
  if (state.lastSpokenAt && Date.now() - state.lastSpokenAt < MIN_COOLDOWN_MS) {
    return;
  }

  const context = buildContext(bot);
  const decision = await decideSpeakOrSilent(bot, context);

  if (decision === 'SILENT') {
    Novus.botDecisionSilent(bot.id, context.progressPct);
    agentStates[bot.id].silenceStreak++;
    return;
  }

  Novus.botDecisionSpeak(bot.id, context.progressPct);

  const reaction = await generateReaction(bot, context);
  if (!reaction) {
    // Graceful fail — treat as silent, no visible error to user
    Novus.botDecisionSilent(bot.id, context.progressPct);
    return;
  }

  displayBotMessage(bot, reaction);

  agentStates[bot.id].lastSpokenAt = Date.now();
  agentStates[bot.id].recentMessages.push(reaction);
  agentStates[bot.id].silenceStreak = 0;

  Novus.botReaction(bot.id, context.progressPct, videoContext.currentTime, reaction.length, reaction);

  // Step 6: other bots may react with emoji only (30% chance each)
  triggerInterBotEmojis(bot);
}

/**
 * Cheap, no-AI check (runs every TRANSCRIPT_CHECK_INTERVAL_MS while playing):
 * is the current playback time inside a real, pre-marked speakable window?
 * If yes — and this bot hasn't already reacted to this exact window since
 * last leaving it — generate a FRESH, transcript-grounded reaction right now.
 * If no — nothing happens, no AI call spent at all.
 */
function checkTranscriptWindowsTick() {
  if (!videoContext.isPlaying) return;
  if (!transcriptAvailable) return;

  const window = getSpeakableWindowAt(videoContext.currentTime);
  if (!window) return;

  const snippet = getTranscriptSnippetForWindow(window);
  const activeBotIds = Object.keys(activeIntervals);

  activeBotIds.forEach((botId, index) => {
    const state = agentStates[botId];
    if (!state) return;
    // Re-entering the SAME window without ever leaving it shouldn't re-trigger.
    // Jumping away and back (or to a different window) clears this naturally,
    // since lastReactedWindowKey will no longer match.
    if (state.lastReactedWindowKey === window.key) return;
    state.lastReactedWindowKey = window.key; // mark immediately — avoids duplicate fires from rapid ticks

    const bot = getAllBots()[botId];
    if (!bot) return;
    const staggerDelay = index * 900 + Math.random() * 500; // light stagger so bots don't all land at once

    setTimeout(async () => {
      const context = buildContext(bot); // also computes timeJumped vs this bot's last seen time
      const reaction = await generateGroundedReaction(bot, context, snippet, window.tag);

      if (!reaction) {
        Novus.botDecisionSilent(bot.id, context.progressPct);
        return;
      }

      displayBotMessage(bot, reaction);
      state.lastSpokenAt = Date.now();
      state.recentMessages.push(reaction);
      state.silenceStreak = 0;

      Novus.botReaction(bot.id, context.progressPct, videoContext.currentTime, reaction.length, reaction);
      triggerInterBotEmojis(bot);
    }, staggerDelay);
  });
}

function triggerInterBotEmojis(speakingBot) {
  const allBots = getAllBots();
  Object.values(allBots).forEach((otherBot) => {
    if (otherBot.id === speakingBot.id) return;
    if (!activeIntervals[otherBot.id]) return; // only active bots
    if (Math.random() < 0.3) {
      const emojiPool = ['💀', '😭', '👀', '🤯', '😂', '🔥'];
      const emoji = emojiPool[Math.floor(Math.random() * emojiPool.length)];
      setTimeout(() => {
        displayInterBotEmoji(otherBot, emoji);
        Novus.interBotEmoji(otherBot.id, emoji);
      }, 400 + Math.random() * 1200);
    }
  });
}

/**
 * Start staggered agent loops for all active bots.
 */
function startAgentLoops(activeBotIds) {
  const allBots = getAllBots();

  activeBotIds.forEach((botId) => {
    const bot = allBots[botId];
    if (!bot) return;

    initAgentState(bot);

    // Stagger: first tick happens at bot.tickOffset seconds, then every 15s after that
    const firstTickDelay = (bot.tickOffset || 0) * 1000;

    const startInterval = () => {
      runAgentTick(bot); // run immediately at offset
      activeIntervals[bot.id] = setInterval(() => runAgentTick(bot), TICK_INTERVAL_MS);
    };

    setTimeout(startInterval, firstTickDelay);
  });

  // Transcript watcher: cheap, content-aware check, runs independently of the
  // per-bot blind tick loop above. Self-gates on transcriptAvailable, so if the
  // transcript hasn't finished loading yet (or never loads), it's a harmless no-op
  // and the blind loop above remains the active path.
  if (!transcriptWatcherInterval) {
    checkTranscriptWindowsTick(); // catch the case where playback started already inside a window
    transcriptWatcherInterval = setInterval(checkTranscriptWindowsTick, TRANSCRIPT_CHECK_INTERVAL_MS);
  }

  // Random welcome message from one bot shortly after load
  setTimeout(() => {
    const ids = activeBotIds;
    const welcomeBot = allBots[ids[Math.floor(Math.random() * ids.length)]];
    if (welcomeBot) {
      generateReaction(welcomeBot, buildContext(welcomeBot)).then((msg) => {
        if (msg) displayBotMessage(welcomeBot, msg || `hey! ready when you are`);
      });
    }
  }, 1000);
}

function pauseAgentLoops() {
  videoContext.isPlaying = false;
}

function resumeAgentLoops() {
  videoContext.isPlaying = true;
}

function stopAgentLoops() {
  Object.values(activeIntervals).forEach(clearInterval);
  Object.keys(activeIntervals).forEach((k) => delete activeIntervals[k]);
  if (transcriptWatcherInterval) {
    clearInterval(transcriptWatcherInterval);
    transcriptWatcherInterval = null;
  }
}

/**
 * Handle a user-sent message: each active bot independently decides whether to reply.
 */
async function handleUserMessage(text) {
  chatLog.push({ sender: 'You', text, timestamp: videoContext.currentTime });
  Novus.userMessageSent(text.length, getProgressPct(), text);

  const allBots = getAllBots();
  const activeBotIds = Object.keys(activeIntervals);

  activeBotIds.forEach((botId, index) => {
    const bot = allBots[botId];
    const staggerDelay = index * 1200; // 0s, 1.2s, 2.5s...

    setTimeout(async () => {
      const context = buildContext(bot);
      const decision = await decideReplyToUser(bot, text, context);
      if (decision === 'SILENT') return;

      const startTime = Date.now();
      const reply = await generateReplyToUser(bot, text, context);
      if (!reply) return; // graceful fail

      displayBotMessage(bot, reply);
      agentStates[bot.id].lastSpokenAt = Date.now();
      Novus.botReplyToUser(bot.id, getProgressPct(), Date.now() - startTime, reply, text);
    }, staggerDelay);
  });
}
