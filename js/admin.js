// ============================================
// ADMIN DASHBOARD — reads REAL local session data
// ============================================
// Note: for the hackathon, this reads from localStorage session logs
// you accumulate during real test sessions. It does NOT fabricate numbers.
// In a production version, this would pull directly from the Novus API.
 
const MAX_STORED_SESSIONS = 50; // keep storage small and predictable, well under any browser's quota
 
function logSessionForAdmin(stats) {
  let sessions = JSON.parse(localStorage.getItem('thesquad_sessions') || '[]');
  sessions.push({ ...stats, timestamp: Date.now() });
 
  // Keep only the most recent N sessions — oldest get dropped first
  if (sessions.length > MAX_STORED_SESSIONS) {
    sessions = sessions.slice(sessions.length - MAX_STORED_SESSIONS);
  }
 
  try {
    localStorage.setItem('thesquad_sessions', JSON.stringify(sessions));
  } catch (err) {
    // Quota exceeded (rare, but possible on some browsers with smaller limits) —
    // drop the oldest half and retry once instead of losing the new session entirely.
    console.warn('localStorage quota issue, trimming old sessions:', err.message);
    sessions = sessions.slice(Math.ceil(sessions.length / 2));
    try {
      localStorage.setItem('thesquad_sessions', JSON.stringify(sessions));
    } catch (err2) {
      console.warn('Still failed after trimming, giving up on this save:', err2.message);
    }
  }
}
 
function getStoredSessions() {
  return JSON.parse(localStorage.getItem('thesquad_sessions') || '[]');
}
 
function computeSegmentSummary(sessions) {
  if (sessions.length === 0) return null;
 
  const botFrequency = {};
  let totalCompletion = 0;
  let totalMessages = 0;
 
  sessions.forEach((s) => {
    (s.bots || []).forEach((botId) => {
      botFrequency[botId] = (botFrequency[botId] || 0) + 1;
    });
    totalCompletion += s.completion_rate || 0;
    totalMessages += s.total_messages_sent || 0;
  });
 
  const favoriteBot = Object.entries(botFrequency).sort((a, b) => b[1] - a[1])[0];
 
  return {
    total_sessions: sessions.length,
    avg_completion_rate: Math.round(totalCompletion / sessions.length),
    avg_messages_per_session: Math.round(totalMessages / sessions.length),
    most_picked_bot: favoriteBot ? favoriteBot[0] : 'n/a',
    bot_frequency: botFrequency
  };
}
 
function renderAdminDashboard() {
  const sessions = getStoredSessions();
  const summary = computeSegmentSummary(sessions);
  const grid = document.getElementById('admin-stats-grid');
 
  if (!summary) {
    grid.innerHTML = `<div class="admin-card"><div class="label">No data yet</div><div class="value" style="font-size:16px;">Run a few real watch sessions first</div></div>`;
    return;
  }
 
  grid.innerHTML = `
    <div class="admin-card"><div class="label">Real sessions logged</div><div class="value">${summary.total_sessions}</div></div>
    <div class="admin-card"><div class="label">Avg completion rate</div><div class="value">${summary.avg_completion_rate}%</div></div>
    <div class="admin-card"><div class="label">Avg messages / session</div><div class="value">${summary.avg_messages_per_session}</div></div>
    <div class="admin-card"><div class="label">Most picked bot</div><div class="value" style="font-size:20px;">${summary.most_picked_bot}</div></div>
  `;
 
  document.getElementById('btn-generate-suggestions').onclick = () => generateAndShowSuggestions(summary);
}
 
async function generateAndShowSuggestions(summary) {
  const box = document.getElementById('admin-suggestions');
  box.innerHTML = `<p style="color: var(--text-dim); font-size: 14px;">Analyzing real session data...</p>`;
 
  const suggestions = await generateAdminSuggestions(summary);
  Novus.adminSuggestionsGenerated(summary, !!suggestions);
 
  if (!suggestions) {
    box.innerHTML = `<p style="color: var(--text-dim); font-size: 14px;">Not enough data yet for meaningful suggestions — run more test sessions.</p>`;
    return;
  }
 
  let html = '';
  if (suggestions.bot_improvements) {
    Object.entries(suggestions.bot_improvements).forEach(([bot, tips]) => {
      html += `<div class="suggestion-item"><strong>${bot}:</strong> ${tips.join(' · ')}</div>`;
    });
  }
  if (suggestions.dropoff_diagnosis) {
    html += `<div class="suggestion-item"><strong>Drop-off diagnosis:</strong> ${suggestions.dropoff_diagnosis}</div>`;
  }
  if (suggestions.new_feature) {
    html += `<div class="suggestion-item"><strong>Suggested next feature:</strong> ${suggestions.new_feature}</div>`;
  }
 
  box.innerHTML = html || `<p style="color: var(--text-dim);">No structured suggestions returned — try again.</p>`;
}