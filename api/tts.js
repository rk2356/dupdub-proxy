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
    console.log('DupDub response keys:', Object.keys(data));

    // Find audio URL in response
    function findAudioUrl(obj) {
      if (!obj || typeof obj !== 'object') return null;
      if (obj.ossFile) return obj.ossFile;
      if (obj.duration_address) return obj.duration_address;
      if (obj.audio_url) return obj.audio_url;
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') {
          const found = findAudioUrl(obj[key]);
          if (found) return found;
        }
      }
      return null;
    }

    const audioUrl = findAudioUrl(data);
    console.log('Found audio URL:', audioUrl ? audioUrl.substring(0, 80) : 'none');

    if (!audioUrl) {
      return res.status(500).json({ error: 'No audio URL in DupDub response', raw: JSON.stringify(data).substring(0, 200) });
    }

    // Fetch the actual audio file and stream it back as binary
    console.log('Fetching audio binary from URL...');
    const audioRes = await fetch(audioUrl);
    const audioCt = audioRes.headers.get('content-type') || 'audio/mpeg';
    const audioBuffer = await audioRes.buffer();
    console.log('Audio fetched, size:', audioBuffer.length, 'type:', audioCt);

    if (audioBuffer.length < 100) {
      // Too small, probably not real audio
      return res.status(500).json({ error: 'Audio file too small, may not be valid', size: audioBuffer.length });
    }

    res.setHeader('Content-Type', audioCt.includes('audio') ? audioCt : 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    return res.status(200).send(audioBuffer);
  } catch (err) {
    console.log('Proxy error:', err.message);
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
};
