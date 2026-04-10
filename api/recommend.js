const https = require('https');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')   { res.status(405).json({ error: 'Method not allowed' }); return; }

  const { patient, test } = req.body;
  if (!patient || !test) { res.status(400).json({ error: 'Missing patient or test data' }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'API key not configured' }); return; }

  const trendText = test.trend != null
    ? `Compared to their previous session, this is a ${test.trend > 0 ? 'improvement' : 'decline'} of ${Math.abs(test.trend)} degrees.`
    : 'This is their first recorded session for this joint.';

  const consistencyText = test.readingSpread <= 5
    ? 'High consistency across all three readings (spread ≤5°).'
    : test.readingSpread <= 10
    ? `Moderate consistency across readings (spread ${test.readingSpread}°).`
    : `High variability across readings (spread ${test.readingSpread}°) — this may indicate pain avoidance, fatigue, or difficulty maintaining position.`;

  const prompt = `You are a senior physiotherapist providing a personalised post-assessment report for a patient.

PATIENT PROFILE:
- Name: ${patient.name}
- Age: ${patient.age} years
- Gender: ${patient.gender}

ASSESSMENT RESULTS — LEFT KNEE FLEXION:
- Measured ROM: ${test.average}° (average of 3 readings: ${test.readings.join('°, ')}°)
- Normal reference range: ${test.norm}° (AAOS standard)
- Percentage of normal: ${Math.round(test.average / test.norm * 100)}%
- Clinical status: ${test.status === 'ok' ? 'Within normal range' : test.status === 'warn' ? 'Mild restriction (below 110°)' : 'Significant restriction (below 80°)'}
- ${consistencyText}
- ${trendText}
- Pain score during assessment: ${test.painScore} / 10
- Sessions completed for this joint: ${test.sessionCount}

Write a personalised physiotherapy recommendation report with the following four sections. Be warm, encouraging, and clinically precise. Use plain language the patient can understand. Do not use bullet points — write in natural paragraphs.

1. WHAT YOUR RESULT MEANS
Explain what the ROM measurement means for this specific patient given their age, gender, and pain score. Put it in everyday context — what movements or daily activities does this level of flexion allow or restrict?

2. YOUR PROGRESS
Comment on their trend, consistency of readings, and pain score. If this is their first session, explain what baseline means and why it matters.

3. RECOMMENDED EXERCISES
Provide 3 specific exercises appropriate for their ROM level, age, and pain score. For each exercise give: the name, exactly how to do it, how many sets and reps, and what to expect. If pain is high (7+), emphasise gentle approaches. If within normal range, focus on maintenance and performance.

4. NEXT STEPS
Tell them when to reassess, what improvements to expect and over what timeframe, what warning signs should prompt them to see a physiotherapist in person, and one piece of motivational advice specific to their situation.`;

  try {
    // Set up streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

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
      apiRes.on('data', chunk => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') { res.write('data: [DONE]\n\n'); return; }
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
              }
            } catch(e) {}
          }
        }
      });
      apiRes.on('end', () => { res.write('data: [DONE]\n\n'); res.end(); });
    });

    apiReq.on('error', e => {
      console.error('Anthropic API error:', e);
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    });

    apiReq.write(body);
    apiReq.end();

  } catch(e) {
    console.error('Function error:', e);
    res.status(500).json({ error: e.message });
  }
};
