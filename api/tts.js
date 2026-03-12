const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'DupDub TTS Proxy running. Send POST request.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { apiKey, speaker, speed, pitch, textList, text } = req.body;

    if (!apiKey) {
      return res.status(400).json({ error: 'apiKey is required' });
    }

    const finalTextList = textList || (text ? [text] : []);
    if (finalTextList.length === 0) {
      return res.status(400).json({ error: 'text or textList is required' });
    }

    const headers = {
      'dupdub_token': apiKey,
      'Content-Type': 'application/json'
    };

    // Search for speaker ID if not in name@style format
    let speakerId = speaker || 'mercury_jane@hopeful';
    if (speakerId && !speakerId.includes('@')) {
      const searchUrl = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?language=English&domainId=1&gender=';
      const searchRes = await fetch(searchUrl, { headers });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const speakers = searchData.data || searchData.result || searchData || [];
        const flatList = Array.isArray(speakers) ? speakers : (speakers.list || speakers.records || []);
        const found = flatList.find(s => {
          const name = (s.name || s.speakerName || s.speaker || '').toLowerCase();
          return name === speakerId.toLowerCase() || name.includes(speakerId.toLowerCase());
        });
        if (found) {
          speakerId = found.speaker || found.speakerId || found.id || speakerId;
        }
      }
    }

    const payload = {
      speaker: speakerId,
      speed: speed || 1.0,
      pitch: pitch || 0,
      textList: finalTextList,
      source: 'web'
    };

    const r = await fetch('https://moyin-gateway.dupdub.com/tts/v1/playDemo/dubForSpeaker', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const contentType = r.headers.get('content-type') || '';

    if (contentType.includes('audio')) {
      const buffer = await r.buffer();
      res.setHeader('Content-Type', contentType);
      res.status(200).send(buffer);
    } else {
      const data = await r.json();
      res.status(r.status).json(data);
    }
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
};
