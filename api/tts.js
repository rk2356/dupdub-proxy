const fetch = require('node-fetch');

// Hindi speaker fallback - detected from DupDub Hindi voices
const HINDI_SPEAKERS = ['swara_madhuri@friendly', 'amitabh_hero@confident', 'priya_bollywood@cheerful'];
const ENGLISH_SPEAKER = 'mercury_jane@hopeful';

function hasHindi(text) {
  return /[\u0900-\u097F]/.test(text);
}

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

    // If speaker already has @ format, use it directly
    let speakerId = speaker && speaker.includes('@') ? speaker : null;

    // If no valid speaker ID, detect language and try to find one
    if (!speakerId) {
      const allText = finalTextList.join(' ');
      const isHindi = hasHindi(allText);
      
      // Try to find speaker from DupDub API
      const lang = isHindi ? 'Hindi' : 'English';
      console.log('No speaker@ ID provided. Searching for', lang, 'speakers...');
      
      try {
        const searchUrl = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?language=' + lang;
        const searchRes = await fetch(searchUrl, { headers });
        const searchData = await searchRes.json();
        
        if (searchData.data && searchData.data.length > 0) {
          // Pick first available speaker
          const firstSpeaker = searchData.data[0];
          speakerId = firstSpeaker.speakerId || firstSpeaker.speaker || firstSpeaker.name;
          console.log('Found speaker from API:', speakerId);
        }
      } catch (e) {
        console.log('Speaker search failed:', e.message);
      }
      
      // Final fallback
      if (!speakerId) {
        speakerId = isHindi ? 'swara_madhuri@friendly' : ENGLISH_SPEAKER;
        console.log('Using fallback speaker:', speakerId);
      }
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
    console.log('DupDub response:', JSON.stringify(data).substring(0, 500));

    // Check for DupDub error
    if (data.message && data.message !== 'Succeed' && data.message !== 'OK' && data.result === null) {
      return res.status(400).json({ error: data.message });
    }

    // Find audio URL
    function findAudioUrl(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 5) return null;
      if (obj.ossFile) return obj.ossFile;
      if (obj.duration_address) return obj.duration_address;
      if (obj.audio_url) return obj.audio_url;
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') {
          const found = findAudioUrl(obj[key], (depth||0)+1);
          if (found) return found;
        }
      }
      return null;
    }

    const audioUrl = findAudioUrl(data, 0);
    console.log('Audio URL:', audioUrl ? audioUrl.substring(0, 80) : 'none');

    if (!audioUrl) {
      return res.status(500).json({ error: 'No audio generated. DupDub said: ' + (data.message || 'Unknown') });
    }

    // Fetch audio binary
    const audioRes = await fetch(audioUrl);
    const audioCt = audioRes.headers.get('content-type') || 'audio/mpeg';
    const audioBuffer = await audioRes.buffer();
    console.log('Audio size:', audioBuffer.length);

    if (audioBuffer.length < 100) {
      return res.status(500).json({ error: 'Audio too small' });
    }

    res.setHeader('Content-Type', audioCt.includes('audio') ? audioCt : 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.length);
    return res.status(200).send(audioBuffer);
  } catch (err) {
    console.log('Proxy error:', err.message);
    res.status(500).json({ error: 'Proxy error: ' + err.message });
  }
};
