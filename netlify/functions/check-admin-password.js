// Netlify Function: verifies the admin password against Supabase server-side.
// The password hash NEVER reaches the browser — this function calls a Postgres
// RPC function (verify_admin_password) that does the bcrypt comparison inside
// the database itself and returns only true/false.

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing Supabase config in environment' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { password } = body;
  if (!password) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing password' }) };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/verify_admin_password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SECRET_KEY,
        'Authorization': `Bearer ${SUPABASE_SECRET_KEY}`
      },
      body: JSON.stringify({ input_password: password })
    });

    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 500, body: JSON.stringify({ error: 'Supabase error: ' + errText }) };
    }

    const authorized = await res.json(); // RPC returns raw boolean

    return {
      statusCode: 200,
      body: JSON.stringify({ authorized: authorized === true })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
