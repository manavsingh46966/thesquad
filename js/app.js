// ============================================
// MAIN APP — navigation, YouTube, wiring
// ============================================

let selectedBotIds = [];
let ytPlayer = null;
let currentVideoId = null;
let progressTrackerInterval = null;

document.addEventListener('DOMContentLoaded', () => {
  Novus.appLoaded();
  trackReturningUser();
  renderSquadPreview();
  renderBotCardGrid();
  wireLandingScreen();
  wireSquadScreen();
  wireCustomBotModal();
  wireWatchRoom();
  wireAdminTrigger();
});

function trackReturningUser() {
  const visits = parseInt(localStorage.getItem('thesquad_visit_count') || '0', 10) + 1;
  localStorage.setItem('thesquad_visit_count', visits);
  if (visits > 1) Novus.userReturned(visits);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ============================================
// SCREEN 1: LANDING
// ============================================

function renderSquadPreview() {
  const bots = getAllBots();
  const container = document.getElementById('squad-preview');
  container.innerHTML = Object.values(bots).map(bot => `
    <div class="squad-preview-bot">
      <div class="bot-avatar" style="--bot-color: ${bot.color}">${bot.emoji}</div>
      <span class="bot-name">${bot.name}</span>
    </div>
  `).join('');
}

function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&]+)/,
    /(?:youtu\.be\/)([^?]+)/,
    /(?:youtube\.com\/embed\/)([^?]+)/
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function wireLandingScreen() {
  const input = document.getElementById('youtube-url-input');
  const btn = document.getElementById('btn-go');
  const errorEl = document.getElementById('landing-error');

  input.addEventListener('input', () => {
    btn.disabled = input.value.trim().length === 0;
    errorEl.textContent = '';
  });

  btn.addEventListener('click', () => {
    const url = input.value.trim();
    const videoId = extractYouTubeId(url);

    if (!videoId) {
      errorEl.textContent = "That doesn't look like a YouTube link — try pasting the full URL.";
      return;
    }

    currentVideoId = videoId;
    Novus.urlSubmitted(videoId);
    showScreen('screen-squad');
    Novus.squadScreenOpened(Object.keys(getAllBots()));
  });

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !btn.disabled) btn.click();
  });
}

// ============================================
// SCREEN 2: SQUAD SELECTION
// ============================================

function renderBotCardGrid() {
  const bots = getAllBots();
  const grid = document.getElementById('bot-card-grid');
  const customCount = getCustomBotCount();

  let html = Object.values(bots).map(bot => `
    <div class="bot-card" data-bot-id="${bot.id}" style="--bot-color: ${bot.color}">
      <div class="checkmark">✓</div>
      <div class="bot-avatar">${bot.emoji}</div>
      <div class="bot-name">${bot.name}</div>
      <div class="bot-tagline">${bot.tagline}</div>
    </div>
  `).join('');

  if (customCount < 2) {
    html += `
      <div class="bot-card add-friend" id="btn-add-friend">
        <div style="font-size: 28px; margin-bottom: 8px;">+</div>
        <div>Add a friend</div>
      </div>
    `;
  }

  grid.innerHTML = html;

  document.querySelectorAll('.bot-card[data-bot-id]').forEach((card) => {
    card.addEventListener('click', () => toggleBotSelection(card));
  });

  const addFriendBtn = document.getElementById('btn-add-friend');
  if (addFriendBtn) {
    addFriendBtn.addEventListener('click', () => {
      document.getElementById('custom-bot-modal').classList.add('active');
    });
  }
}

function toggleBotSelection(card) {
  const botId = card.dataset.botId;
  card.classList.toggle('selected');
  const isSelected = card.classList.contains('selected');

  if (isSelected) {
    selectedBotIds.push(botId);
  } else {
    selectedBotIds = selectedBotIds.filter((id) => id !== botId);
  }

  Novus.botToggled(botId, isSelected);
}

function wireSquadScreen() {
  document.getElementById('btn-start-watching').addEventListener('click', () => {
    if (selectedBotIds.length === 0) {
      alert('Pick at least one friend to watch with!');
      return;
    }
    Novus.sessionStarted(selectedBotIds, currentVideoId);
    showScreen('screen-watch');
    loadYouTubeVideo(currentVideoId);
  });
}

// ============================================
// CUSTOM BOT MODAL
// ============================================

function wireCustomBotModal() {
  const modal = document.getElementById('custom-bot-modal');

  document.getElementById('btn-cancel-custom-bot').addEventListener('click', () => {
    modal.classList.remove('active');
  });

  document.getElementById('btn-create-custom-bot').addEventListener('click', async () => {
    const name = document.getElementById('custom-bot-name').value.trim();
    const desc = document.getElementById('custom-bot-desc').value.trim();

    if (!name || !desc) {
      alert('Give your friend a name and a quick description!');
      return;
    }

    const createBtn = document.getElementById('btn-create-custom-bot');
    createBtn.disabled = true;
    createBtn.textContent = 'Creating...';

    try {
      const personalityPrompt = await createCustomBotPersonality(name, desc);
      const emojiPool = ['💀', '🔥', '👀', '🎬', '🤌'];
      const bot = saveCustomBot({
        id: 'custom_' + Date.now(),
        name,
        emoji: emojiPool[Math.floor(Math.random() * emojiPool.length)],
        tagline: 'Your friend',
        personalityPrompt
      });

      Novus.customBotCreated(bot.name, bot.emoji);
      renderBotCardGrid();
      modal.classList.remove('active');
      document.getElementById('custom-bot-name').value = '';
      document.getElementById('custom-bot-desc').value = '';
    } catch (err) {
      alert(err.message || 'Could not create that friend right now — try again.');
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = 'Create';
    }
  });
}

// ============================================
// SCREEN 3: WATCH ROOM — YouTube integration
// ============================================

function loadYouTubeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve();
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = resolve;
  });
}

async function fetchVideoTitle(videoId) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    if (!res.ok) throw new Error('oEmbed failed');
    const data = await res.json();
    return data.title;
  } catch {
    return 'this video';
  }
}

async function loadYouTubeVideo(videoId) {
  await loadYouTubeAPI();
  const title = await fetchVideoTitle(videoId);

  videoContext.videoId = videoId;
  videoContext.title = title;
  Novus.videoLoaded(videoId, title);

  ytPlayer = new YT.Player('youtube-player', {
    videoId,
    playerVars: { autoplay: 1, rel: 0 },
    events: {
      onReady: () => {
        videoContext.duration = ytPlayer.getDuration() || 1;
        startProgressTracker();
      },
      onStateChange: handlePlayerStateChange
    }
  });
}

function startProgressTracker() {
  if (progressTrackerInterval) clearInterval(progressTrackerInterval);
  progressTrackerInterval = setInterval(() => {
    if (ytPlayer && ytPlayer.getCurrentTime) {
      videoContext.currentTime = ytPlayer.getCurrentTime();
    }
  }, 1000);
}

function handlePlayerStateChange(event) {
  // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering
  if (event.data === 1) {
    videoContext.isPlaying = true;
    resumeAgentLoops();
    Novus.videoPlayed(videoContext.currentTime);
    if (Object.keys(activeIntervals).length === 0) {
      startAgentLoops(selectedBotIds);
    }
  } else if (event.data === 2) {
    pauseAgentLoops();
    const progressPct = Math.round((videoContext.currentTime / videoContext.duration) * 100);
    Novus.videoPaused(videoContext.currentTime, progressPct);
    fireCasualPauseLine();
  } else if (event.data === 0) {
    handleVideoEnded();
  }
}

function fireCasualPauseLine() {
  const allBots = getAllBots();
  const activeIds = Object.keys(activeIntervals);
  if (activeIds.length === 0) return;
  const bot = allBots[activeIds[Math.floor(Math.random() * activeIds.length)]];
  const lines = ['snack break? 👀', 'taking a sec, got it', 'okay pausing... things were getting real'];
  displayBotMessage(bot, lines[Math.floor(Math.random() * lines.length)]);
}

function handleVideoEnded() {
  stopAgentLoops();
  const watchTime = videoContext.currentTime;
  const completionRate = Math.round((watchTime / videoContext.duration) * 100);

  const endStats = {
    total_watch_time: Math.round(watchTime),
    completion_rate: completionRate,
    total_messages_sent: chatLog.length,
    most_active_bot: getMostActiveBot(),
    bots: selectedBotIds
  };

  Novus.videoEnded(endStats);

  const userMessageCount = chatLog.filter(m => m.sender === 'You').length;
  if (userMessageCount === 0) {
    Novus.userIgnoredBots(endStats.total_watch_time, selectedBotIds.length, currentVideoId, completionRate);
  }

  logSessionForAdmin(endStats); // real data for admin dashboard, no fabrication

  // Staggered final hot takes
  const allBots = getAllBots();
  selectedBotIds.forEach((botId, i) => {
    setTimeout(async () => {
      const bot = allBots[botId];
      const reaction = await generateReaction(bot, {
        title: videoContext.title,
        timestamp: 'the end',
        progressPct: 100,
        recentMessages: chatLog.slice(-5),
        secondsSinceLastSpoke: 0
      });
      if (reaction) displayBotMessage(bot, reaction);
    }, i * 1500);
  });
}

function getMostActiveBot() {
  const counts = {};
  chatLog.forEach((msg) => {
    if (msg.sender !== 'You') counts[msg.sender] = (counts[msg.sender] || 0) + 1;
  });
  let best = null, max = 0;
  Object.entries(counts).forEach(([name, count]) => {
    if (count > max) { max = count; best = name; }
  });
  return best;
}

function wireWatchRoom() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('btn-send-message');

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    displayUserMessage(text);
    handleUserMessage(text);
    input.value = '';
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keypress', (e) => { if (e.key === 'Enter') send(); });
}

// ============================================
// SCREEN 4: ADMIN ACCESS (secret route)
// ============================================

function wireAdminTrigger() {
  if (window.location.hash === '#admin') {
    showScreen('screen-admin');
    renderAdminDashboard();
  }
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#admin') {
      showScreen('screen-admin');
      renderAdminDashboard();
    }
  });
}