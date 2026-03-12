const fetch = require('node-fetch');

const ENGLISH_SPEAKER = 'mercury_jane@hopeful';

function hasHindi(text) {
  return /[\u0900-\u097F]/.test(text);
}

function isEnglishSpeaker(sp) {
  if (!sp) return false;
  const englishNames = ['mercury', 'jane', 'john', 'emma', 'david', 'sarah', 'michael', 'rachel', 'spiderman', 'spoongy'];
  return englishNames.some(n => sp.toLowerCase().includes(n));
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
    const allText = finalTextList.join(' ');
    const isHindi = hasHindi(allText);
    
    console.log('Language:', isHindi ? 'Hindi' : 'English', '| Speaker from frontend:', speaker);

    let speakerId = speaker && speaker.includes('_') ? speaker : null;

    // If Hindi text but non-Hindi speaker, override
    if (isHindi && speakerId && !speakerId.toLowerCase().includes('hindi')) {
      console.log('Hindi text but non-Hindi speaker. Will search for Hindi speaker.');
      speakerId = null;
    }

    // If no valid speaker, search DupDub API
    if (!speakerId) {
      const lang = isHindi ? 'Hindi' : 'English';
      console.log('Searching for', lang, 'speakers...');
      
      try {
        const searchUrl = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?language=' + lang;
        const searchRes = await fetch(searchUrl, { headers });
        const searchData = await searchRes.json();
        console.log('Search response code:', searchData.code, 'results count:', searchData.data?.results?.length || 0);
        
        // API returns {data: {results: [...]}}
        if (searchData.data && searchData.data.results && searchData.data.results.length > 0) {
          // Use the 'speaker' field which is what dubForSpeaker needs
          const firstSpeaker = searchData.data.results[0];
          speakerId = firstSpeaker.speaker;
          console.log('Found speaker:', speakerId, 'Name:', firstSpeaker.name);
        }
      } catch (e) {
        console.log('Speaker search failed:', e.message);
      }
      
      if (!speakerId) {
        speakerId = isHindi ? 'saturn_swara_neural' : ENGLISH_SPEAKER;
        console.log('Using fallback:', speakerId);
      }
    }

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

    if (contentType.includes('audio')) {
      const buffer = await r.buffer();
      res.setHeader('Content-Type', contentType);
      return res.status(200).send(buffer);
    }

    const data = await r.json();
    console.log('DupDub response:', JSON.stringify(data).substring(0, 500));

    if (data.code && data.code !== 200) {
      return res.status(400).json({ error: 'DupDub error: ' + (data.message || 'Unknown'), code: data.code });
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
      return res.status(500).json({ error: 'No audio in response. Message: ' + (data.message || 'Unknown') });
    }

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
