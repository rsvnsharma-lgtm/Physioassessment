const https = require('https');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Parse body — Vercel auto-parses JSON when Content-Type is application/json
  const { patient, test } = req.body || {};
  if (!patient || !test) {
    res.status(400).json({ error: 'Missing patient or test data' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'API key not configured on server' });
    return;
  }

  const trendText = test.trend != null
    ? `Compared to their previous session, this is a ${test.trend > 0 ? 'improvement' : 'decline'} of ${Math.abs(test.trend)} degrees.`
    : 'This is their first recorded session for this joint.';

  const consistencyText = test.readingSpread <= 5
    ? 'High consistency across all three readings.'
    : test.readingSpread <= 10
    ? `Moderate consistency across readings (spread ${test.readingSpread} degrees).`
    : `High variability across readings (spread ${test.readingSpread} degrees).`;

  const prompt = `You are a senior physiotherapist writing a personalised post-assessment report.

PATIENT: ${patient.name}, ${patient.age} years old, ${patient.gender}

ASSESSMENT — LEFT KNEE FLEXION:
- Measured ROM: ${test.average}° (readings: ${test.readings.join('°, ')}°)
- Normal reference: ${test.norm}° (AAOS)
- Percentage of normal: ${Math.round(test.average / test.norm * 100)}%
- Status: ${test.status === 'ok' ? 'Within normal range' : test.status === 'warn' ? 'Mild restriction (below 110°)' : 'Significant restriction (below 80°)'}
- ${consistencyText}
- ${trendText}
- Pain score during assessment: ${test.painScore} / 10
- Total sessions completed: ${test.sessionCount}

Write a warm, clinically accurate personalised report in four sections. Use plain language. Write in natural paragraphs — no bullet points.

1. WHAT YOUR RESULT MEANS
Explain what this ROM means for daily life for this specific patient given their age, gender and pain level.

2. YOUR PROGRESS
Comment on trend, consistency and pain score. If first session, explain why baseline matters.

3. RECOMMENDED EXERCISES
Give 3 specific exercises for their ROM level and pain score. For each: name, exactly how to do it, sets and reps, what to expect.

4. NEXT STEPS
When to reassess, expected improvement timeline, warning signs to watch for, and one motivational note specific to their situation.`;

  try {
    // Stream SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const body = JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      stream: true,
      messages: [{ role: 'user', content: prompt }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const apiReq = https.request(options, apiRes => {
      let buffer = '';

      apiRes.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
            }
          } catch (e) {
            // skip malformed lines
          }
        }
      });

      apiRes.on('end', () => {
        res.write('data: [DONE]\n\n');
        res.end();
      });

      apiRes.on('error', e => {
        res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        res.end();
      });
    });

    apiReq.on('error', e => {
      console.error('Request error:', e);
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    });

    apiReq.write(body);
    apiReq.end();

  } catch (e) {
    console.error('Function error:', e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
};
