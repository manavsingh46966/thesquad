// ============================================
// NOVUS TRACKING LAYER
// ============================================
// Novus auto-instruments most UI interactions once its snippet is installed.
// This wrapper sends explicit custom events for things Novus can't infer on its own
// (bot decisions, personality preferences, video progress milestones, etc.)

function trackEvent(eventName, properties = {}) {
  try {
    if (typeof window !== 'undefined' && window.novus && typeof window.novus.track === 'function') {
      window.novus.track(eventName, properties);
    } else {
      // Novus snippet not loaded (e.g. local dev) — log so nothing is silently lost
      console.log('[novus:dev]', eventName, properties);
    }
  } catch (err) {
    console.warn('Novus tracking failed (non-blocking):', err.message);
  }
}

// Convenience wrappers matching the event map from the workflow doc
const Novus = {
  appLoaded: () => trackEvent('app_loaded', { timestamp: Date.now() }),

  urlSubmitted: (videoId) => trackEvent('url_submitted', { video_id: videoId }),

  squadScreenOpened: (botsAvailable) => trackEvent('squad_screen_opened', { bots_available: botsAvailable }),

  botToggled: (botId, selected) => trackEvent('bot_toggled', { bot_id: botId, selected }),

  customBotCreated: (name, emoji) => trackEvent('custom_bot_created', { name, emoji }),

  sessionStarted: (bots, videoId) => trackEvent('session_started', {
    bots, video_id: videoId, bot_count: bots.length
  }),

  videoLoaded: (videoId, title) => trackEvent('video_loaded', { video_id: videoId, title }),

  videoPlayed: (timestamp) => trackEvent('video_played', { timestamp }),

  videoPaused: (timestamp, progressPct) => trackEvent('video_paused', { timestamp, progress_pct: progressPct }),

  videoEnded: (stats) => trackEvent('video_ended', stats),

  botDecisionSpeak: (botId, progressPct) => trackEvent('bot_decision_speak', { bot_id: botId, video_progress: progressPct }),

  botDecisionSilent: (botId, progressPct) => trackEvent('bot_decision_silent', { bot_id: botId, video_progress: progressPct }),

  botReaction: (botId, progressPct, timestamp, reactionLength) => trackEvent('bot_reaction', {
    bot: botId, video_progress: progressPct, timestamp, reaction_length: reactionLength
  }),

  interBotEmoji: (fromBot, mood) => trackEvent('inter_bot_emoji', { from_bot: fromBot, mood }),

  botReplyToUser: (botId, progressPct, responseTimeMs) => trackEvent('bot_reply_to_user', {
    bot: botId, video_progress: progressPct, response_time_ms: responseTimeMs
  }),

  userMessageSent: (length, progressPct) => trackEvent('user_message_sent', { length, video_progress: progressPct }),

  userIgnoredBots: (sessionLength) => trackEvent('user_ignored_bots', { session_length: sessionLength }),

  userReturned: (sessionNumber) => trackEvent('user_returned', { session_number: sessionNumber }),

  botCallFailed: (reason, attempt) => trackEvent('bot_call_failed', { reason, attempt })
};
