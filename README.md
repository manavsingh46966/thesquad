# The Squad — Setup & Deploy

Watch anything together, with an AI squad that reacts in real time.

## Local Setup
#for admin dasboard go to -https://thesquadd.netlify.app/report.html
password- M@hi2005
1. **Get a Gemini API key**
   - Go to https://aistudio.google.com/app/apikey
   - Create a free API key

2. **Install Netlify CLI** (for local dev with serverless functions)
   ```
   npm install -g netlify-cli
   ```

3. **Set your API key locally**
   Create a `.env` file in the project root:
   ```
   GEMINI_API_KEY=your_key_here
   ```

4. **Run locally**
   ```
   netlify dev
   ```
   This serves the site AND the serverless function together, so Gemini calls work exactly like production.

## Deploy to Netlify

1. Push this folder to a GitHub repo
2. Go to https://app.netlify.com → "Add new site" → "Import from Git"
3. Connect your repo (build command: leave blank, publish directory: `.`)
4. In Site Settings → Environment Variables, add:
   ```
   GEMINI_API_KEY = your_key_here
   ```
5. Deploy — you'll get a live URL instantly

## Installing Novus

Replace the placeholder script in `index.html`:
```html
<script>
  // window.novus = { track: function(event, props) { ... } };
</script>
```
with the real install snippet from https://novus.pendo.io/register

## Admin Dashboard

Visit `yoursite.netlify.app/#admin` to see the internal dashboard.
It only shows data from real sessions run on that browser (stored in localStorage)
— it does not fabricate numbers. Run a few real watch sessions first so there's
something to show.

## Architecture Notes

- **No backend server** — all logic runs in the browser. The only server-side piece
  is a tiny Netlify Function that proxies Gemini calls so the API key isn't exposed
  in the frontend source.
- **Agentic bot loop** — each bot runs its own staggered 15s decision tick
  (`js/agents.js`). Decisions are hardened with timeouts, one retry, and graceful
  fallback to silence on failure — so a flaky API call never crashes the demo,
  it just looks like the bot chose not to speak.
- **Memory** — session history lives in `localStorage`. No database needed for
  the hackathon scope.

## File Map

```
thesquad/
  index.html              ← all 4 screens
  css/style.css           ← full design system
  js/
    bots.js               ← personality definitions + custom bot storage
    gemini.js              ← Gemini calls (decision + generation, hardened)
    agents.js              ← staggered agentic loop
    reactions.js            ← chat rendering + animations
    novus.js                ← event tracking wrapper
    admin.js                ← real-data dashboard + AI suggestions
    app.js                  ← navigation, YouTube integration, wiring
  netlify/functions/
    gemini.js                ← serverless proxy, hides API key
  netlify.toml
```
