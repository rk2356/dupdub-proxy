const fetch = require('node-fetch');
const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'DupDub TTS Proxy is running. Send POST request.' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { appkey, secret, text, speaker, speed, pitch, volume, audio_type } = req.body;

    if (!appkey || !secret) {
      return res.status(400).json({ error: 'appkey and secret are required' });
    }
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash('md5').update(appkey + secret + timestamp).digest('hex');

    const params = new URLSearchParams();
    params.append('appkey', appkey);
    params.append('signature', signature);
    params.append('timestamp', timestamp.toString());
    params.append('text', text);
    params.append('product', 'openapi');
    if (speaker) params.append('speaker', speaker);
    if (speed) params.append('speed', speed.toString());
    if (pitch !== undefined && pitch !== null) params.append('pitch', pitch.toString());
    if (volume) params.append('volume', volume.toString());
    params.append('audio_type', audio_type || 'mp3');

    const r = await fetch('https://openapi.dupdub.com/api/tts/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
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
