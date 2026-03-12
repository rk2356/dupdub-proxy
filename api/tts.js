const fetch = require('node-fetch');

// Known speaker ID mapping (display name -> DupDub internal ID)
const SPEAKER_MAP = {
  'spoongy': 'spoongy@default',
  'sunshine blondie': 'sunshine_blondie@default',
  'adam': 'adam@default',
  'kung master': 'kung_master@default',
  'panda warrior': 'panda_warrior@default',
  'mercury jane': 'mercury_jane@hopeful'
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'DupDub TTS Proxy running.' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { apiKey, speaker, speed, pitch, textList, text } = req.body;
    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

    const finalTextList = textList || (text ? [text] : []);
    if (finalTextList.length === 0) return res.status(400).json({ error: 'text is required' });

    const headers = { 'dupdub_token': apiKey, 'Content-Type': 'application/json' };

    // Resolve speaker ID
    let speakerId = speaker || 'mercury_jane@hopeful';
    const lowerSpeaker = speakerId.toLowerCase();

    // If not already in name@style format, try lookup
    if (!speakerId.includes('@')) {
      // Check hardcoded map first
      if (SPEAKER_MAP[lowerSpeaker]) {
        speakerId = SPEAKER_MAP[lowerSpeaker];
      } else {
        // Search DupDub API for speaker
        try {
          const searchUrl = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?language=English&domainId=1&gender=';
          const searchRes = await fetch(searchUrl, { headers });
          if (searchRes.ok) {
            const searchData = await searchRes.json();
            console.log('Speaker search response keys:', Object.keys(searchData));
            // Try to find in various response structures
            let list = [];
            if (searchData.data && Array.isArray(searchData.data)) list = searchData.data;
            else if (searchData.data && searchData.data.list) list = searchData.data.list;
            else if (searchData.data && searchData.data.records) list = searchData.data.records;
            else if (Array.isArray(searchData)) list = searchData;

            if (list.length > 0) {
              console.log('First speaker sample:', JSON.stringify(list[0]).substring(0, 200));
              const found = list.find(s => {
                const names = [s.name, s.speakerName, s.speaker, s.displayName].filter(Boolean).map(n => n.toLowerCase());
                return names.some(n => n === lowerSpeaker || n.includes(lowerSpeaker));
              });
              if (found) {
                speakerId = found.speaker || found.speakerId || found.id || speakerId;
                console.log('Found speaker:', speakerId);
              }
            }
          }
        } catch (searchErr) {
          console.log('Speaker search error:', searchErr.message);
        }
      }
    }

    console.log('Using speaker:', speakerId, 'for input:', speaker);

    const payload = {
      speaker: speakerId,
      speed: speed || 1.0,
      pitch: pitch || 0,
      textList: finalTextList,
      source: 'web'
    };

    console.log('TTS payload:', JSON.stringify(payload));

    const r = await fetch('https://moyin-gateway.dupdub.com/tts/v1/playDemo/dubForSpeaker', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const contentType = r.headers.get('content-type') || '';
    console.log('DupDub response status:', r.status, 'content-type:', contentType);

    if (contentType.includes('audio')) {
      const buffer = await r.buffer();
      res.setHeader('Content-Type', contentType);
      res.status(200).send(buffer);
    } else {
      const data = await r.json();
      console.log('DupDub response body:', JSON.stringify(data).substring(0, 500));
      res.status(r.status).json(data);
    }
  } catch (err) {
    console.log('Proxy error:', err.message);
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
};
