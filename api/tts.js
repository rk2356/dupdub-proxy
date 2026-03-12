const fetch = require('node-fetch');

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

    let speakerId = 'mercury_jane@hopeful';
    if (speaker && speaker.includes('@')) {
      speakerId = speaker;
    }

    const payload = {
      speaker: speakerId,
      speed: speed || 1.0,
      pitch: pitch || 0,
      textList: finalTextList,
      source: 'web'
    };

    console.log('TTS request:', JSON.stringify(payload));

    const r = await fetch('https://moyin-gateway.dupdub.com/tts/v1/playDemo/dubForSpeaker', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const contentType = r.headers.get('content-type') || '';
    if (contentType.includes('audio')) {
      const buffer = await r.buffer();
      res.setHeader('Content-Type', contentType);
      return res.status(200).send(buffer);
    }

    const data = await r.json();
    console.log('DupDub full response:', JSON.stringify(data));

    // Deep search for audio URL in response
    function findAudioUrl(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.duration_address) return obj.duration_address;
      if (obj.ossFile) return obj.ossFile;
      if (obj.audio_url) return obj.audio_url;
      if (obj.audioUrl) return obj.audioUrl;
      for (const key of Object.keys(obj)) {
        const found = findAudioUrl(obj[key]);
        if (found) return found;
      }
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const found = findAudioUrl(item);
          if (found) return found;
        }
      }
      return null;
    }

    const audioUrl = findAudioUrl(data);
    console.log('Extracted audio URL:', audioUrl);

    if (audioUrl) {
      return res.status(200).json({
        audio_url: audioUrl,
        duration: (data.result && data.result.lengthOfTime) || null
      });
    }

    // No audio URL found - return error
    res.status(500).json({ error: 'No audio URL found in DupDub response', raw: data });
  } catch (err) {
    console.log('Proxy error:', err.message);
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
};
