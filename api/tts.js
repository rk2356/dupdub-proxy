module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.json({ status: 'ok', message: 'DupDub TTS Proxy running.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, text, speakerId, speakerName, speed, pitch } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (!speakerId) return res.status(400).json({ error: 'speakerId is required' });

  const headers = { 'dupdub_token': apiKey, 'Content-Type': 'application/json' };

  try {
    const ttsResponse = await fetch('https://moyin-gateway.dupdub.com/tts/v1/playDemo/dubForSpeaker', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        speaker: speakerId,
        speed: String(speed || 1.0),
        pitch: String(pitch || 0),
        textList: [text],
        source: 'web'
      })
    });

    const contentType = ttsResponse.headers.get('content-type') || '';

    if (contentType.includes('audio') || contentType.includes('octet')) {
      const buffer = Buffer.from(await ttsResponse.arrayBuffer());
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);
      return res.status(200).send(buffer);
    }

    const data = await ttsResponse.json();

    if (data.code && data.code !== 200) {
      return res.status(400).json({ error: 'DupDub error: ' + (data.message || 'Unknown'), code: data.code });
    }

    // Find audio URL in response
    function findOssFile(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 5) return null;
      if (obj.ossFile && typeof obj.ossFile === 'string') return obj.ossFile;
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') {
          const found = findOssFile(obj[key], (depth || 0) + 1);
          if (found) return found;
        }
      }
      return null;
    }

    const audioUrl = findOssFile(data, 0);
    if (!audioUrl) {
      return res.status(500).json({ error: 'No audio URL in DupDub response', raw: JSON.stringify(data).substring(0, 200) });
    }

    const audioRes = await fetch(audioUrl);
    const audioCt = audioRes.headers.get('content-type') || 'audio/mpeg';
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    if (audioBuffer.length < 100) {
      return res.status(500).json({ error: 'Audio file too small, generation may have failed' });
    }

    res.setHeader('Content-Type', audioCt.includes('audio') ? audioCt : 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    return res.status(200).send(audioBuffer);

  } catch (err) {
    return res.status(500).json({ error: 'Proxy error: ' + err.message });
  }
};
