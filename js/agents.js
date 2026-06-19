// ============================================
// AGENTIC LOOP — staggered, hardened, per-bot
// ============================================

const TICK_INTERVAL_MS = 15000; // 15s base interval
const agentStates = {}; // botId -> AgentState
const activeIntervals = {}; // botId -> interval handle
let chatLog = []; // shared chat history: {sender, text, timestamp}
let videoContext = { title: '', videoId: '', currentTime: 0, duration: 1, isPlaying: false };

function initAgentState(bot) {
  agentStates[bot.id] = {
    lastSpokenAt: null,
    recentMessages: [],
    silenceStreak: 0,
    personalityPrompt: bot.personalityPrompt
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

  return {
    title: videoContext.title,
    timestamp: formatTimestamp(videoContext.currentTime),
    progressPct: getProgressPct(),
    recentMessages: chatLog.slice(-5),
    secondsSinceLastSpoke
  };
}

/**
 * Single tick for one bot: decide, maybe react, update state, track.
 */
async function runAgentTick(bot) {
  if (!videoContext.isPlaying) return; // don't tick while paused

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
