// ============================================
// CHAT RENDERING
// ============================================

function getChatContainer() {
  return document.getElementById('chat-messages');
}

function showTypingIndicator(bot) {
  const container = getChatContainer();
  const indicator = document.createElement('div');
  indicator.className = 'typing-indicator';
  indicator.id = `typing-${bot.id}`;
  indicator.style.setProperty('--bot-color', bot.color);
  indicator.innerHTML = `<span class="bot-emoji">${bot.emoji}</span><span class="dots"><span></span><span></span><span></span></span>`;
  container.appendChild(indicator);
  container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator(bot) {
  const el = document.getElementById(`typing-${bot.id}`);
  if (el) el.remove();
}

function displayBotMessage(bot, text) {
  showTypingIndicator(bot);
  const delay = 500 + Math.random() * 1500; // Fix: feels human, 0.5-2s

  setTimeout(() => {
    removeTypingIndicator(bot);

    const container = getChatContainer();
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message bot-message';
    msgEl.style.setProperty('--bot-color', bot.color);
    msgEl.innerHTML = `
      <div class="message-sender">${bot.emoji} ${bot.name}</div>
      <div class="message-text">${escapeHtml(text)}</div>
    `;
    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;

    chatLog.push({ sender: bot.name, text, timestamp: videoContext.currentTime });
    pruneOldMessages();
  }, delay);
}

function displayInterBotEmoji(bot, emoji) {
  const container = getChatContainer();
  const emojiEl = document.createElement('div');
  emojiEl.className = 'inter-bot-emoji';
  emojiEl.style.setProperty('--bot-color', bot.color);
  emojiEl.innerHTML = `<span class="bot-emoji-small">${bot.emoji}</span> ${emoji}`;
  container.appendChild(emojiEl);
  container.scrollTop = container.scrollHeight;

  // Fade out after a few seconds — keeps chat from getting cluttered
  setTimeout(() => {
    emojiEl.classList.add('fade-out');
    setTimeout(() => emojiEl.remove(), 500);
  }, 4000);
}

function displayUserMessage(text) {
  const container = getChatContainer();
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-message user-message';
  msgEl.innerHTML = `
    <div class="message-sender">You</div>
    <div class="message-text">${escapeHtml(text)}</div>
  `;
  container.appendChild(msgEl);
  container.scrollTop = container.scrollHeight;
}

function pruneOldMessages() {
  // Keep DOM light during long sessions — keep last 50 messages visible
  const container = getChatContainer();
  while (container.children.length > 50) {
    container.removeChild(container.firstChild);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
