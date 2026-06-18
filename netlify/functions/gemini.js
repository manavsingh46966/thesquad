// Netlify Function: proxies requests to Gemini API so the key never reaches the browser
// Deploys automatically with the rest of the site — no separate backend needed.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing API key in environment' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { prompt, model = 'gemini-1.5-flash', maxTokens = 100 } = body;
  if (!prompt) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing prompt' }) };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.9
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: res.status, body: JSON.stringify({ error: errText }) };
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return {
      statusCode: 200,
      body: JSON.stringify({ text })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
