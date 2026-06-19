// Netlify Function: proxies requests to NEAR AI Cloud (OpenAI-compatible) so the key never reaches the browser
// Deploys automatically with the rest of the site — no separate backend needed.
// Note: filename/endpoint path kept as "gemini" so the existing /.netlify/functions/gemini
// route the frontend already calls doesn't need to change.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const NEAR_API_KEY = process.env.NEAR_API_KEY;
  if (!NEAR_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing API key in environment' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  // model is passed in from the frontend per-call (two-tier strategy lives in js/gemini.js)
  const { prompt, model = 'openai/gpt-4.1-nano', maxTokens = 100 } = body;
  if (!prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt' }) };
  }

  try {
    const url = 'https://cloud-api.near.ai/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${NEAR_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.9
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: errText }) };
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';

    return {
      statusCode: 200,
      body: JSON.stringify({ text })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
