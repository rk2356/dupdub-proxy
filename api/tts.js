const fetch = require('node-fetch');

function hasHindi(text) {
  return /[\u0900-\u097F]/.test(text);
}

// Hardcoded speaker IDs for guaranteed correct voice matching
const SPEAKER_MAP = {
  'spoongy': 'uranus||||c2d38855d8f15bedd8d3881fd6d85647',
    'sunshine blondie': null, // Will be resolved via search
  'adam': 'uranus_Adam',
  'panda warrior': 'uranus||||054c58511d158071e0b4983d68894bd5',
  'kung master': null // Will be resolved via search
};

async function callTTS(headers, payload) {
  const r = await fetch('https://moyin-gateway.dupdub.com/tts/v1/playDemo/dubForSpeaker', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const contentType = r.headers.get('content-type') || '';
  if (contentType.includes('audio')) {
    const buffer = await r.buffer();
    return { type: 'audio', buffer, contentType };
  }
  const data = await r.json();
  return { type: 'json', data };
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
    const lang = isHindi ? 'Hindi' : 'English';
    const speakerName = (speaker || '').trim();
    console.log('Speaker from frontend:', speakerName, '| Language:', lang);

    // Step 1: Check hardcoded map first
    let speakerId = SPEAKER_MAP[speakerName.toLowerCase()] || null;
    if (speakerId) {
      console.log('Using hardcoded speaker ID:', speakerId);
    }

    // Step 2: If not in map, search DupDub API
    if (!speakerId && speakerName) {
      try {
        const broadUrl = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?pageSize=800';
        const broadRes = await fetch(broadUrl, { headers });
        const broadData = await broadRes.json();
        const totalResults = broadData.data && broadData.data.results ? broadData.data.results.length : 0;
        console.log('Broad search results:', totalResults);

        if (broadData.data && broadData.data.results && broadData.data.results.length > 0) {
          const match = broadData.data.results.find(s =>
            s.name && s.name.toLowerCase() === speakerName.toLowerCase()
          );
          if (match) {
            speakerId = match.speaker;
            console.log('Found exact match:', match.name, '| Full speaker ID:', speakerId);
          }
        }
      } catch (e) {
        console.log('Broad search error:', e.message);
      }
    }

    // Step 3: Fallback to first speaker for language
    if (!speakerId) {
      console.log('No match for "' + speakerName + '". Getting first', lang, 'speaker...');
      try {
        const fallbackUrl = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?language=' + lang;
        const fallbackRes = await fetch(fallbackUrl, { headers });
        const fallbackData = await fallbackRes.json();
        if (fallbackData.data && fallbackData.data.results && fallbackData.data.results.length > 0) {
          speakerId = fallbackData.data.results[0].speaker;
          console.log('Using first available:', speakerId);
        }
      } catch (e) {
        console.log('Fallback search error:', e.message);
      }
    }

    if (!speakerId) {
      return res.status(400).json({ error: 'Could not find any speaker for: ' + speakerName });
    }

    const payload = {
      speaker: speakerId,
      speed: speed || 1.0,
      pitch: pitch || 0,
      textList: finalTextList,
      source: 'web'
    };
    console.log('TTS payload speaker:', speakerId);

    // Call TTS with retry on failure
    let result = await callTTS(headers, payload);

    if (result.type === 'audio') {
      console.log('Direct audio response, size:', result.buffer.length);
      res.setHeader('Content-Type', result.contentType);
      return res.status(200).send(result.buffer);
    }

    let data = result.data;
    console.log('DupDub response:', JSON.stringify(data).substring(0, 500));

    // Check for DupDub server error (code 3009) and retry once
    if (data.data && data.data.resList && data.data.resList[0] && !data.data.resList[0].success) {
      const errCode = data.data.resList[0].code;
      const errMsg = data.data.resList[0].message;
      console.log('DupDub TTS error code:', errCode, '| message:', errMsg, '| Retrying...');
      await new Promise(r => setTimeout(r, 2000));
      result = await callTTS(headers, payload);
      if (result.type === 'audio') {
        console.log('Retry: Direct audio response, size:', result.buffer.length);
        res.setHeader('Content-Type', result.contentType);
        return res.status(200).send(result.buffer);
      }
      data = result.data;
      console.log('Retry DupDub response:', JSON.stringify(data).substring(0, 500));
      // Check if retry also failed
      if (data.data && data.data.resList && data.data.resList[0] && !data.data.resList[0].success) {
        return res.status(500).json({ error: 'DupDub server error (code ' + data.data.resList[0].code + '): ' + data.data.resList[0].message });
      }
    }

    if (data.code && data.code !== 200) {
      return res.status(400).json({ error: 'DupDub error: ' + (data.message || 'Unknown'), code: data.code });
    }

    // Find audio URL - ONLY look for ossFile (actual audio), NOT duration_address (JSON metadata)
    function findOssFile(obj, depth) {
      if (!obj || typeof obj !== 'object' || depth > 5) return null;
      if (obj.ossFile && typeof obj.ossFile === 'string' && obj.ossFile.includes('.wav')) return obj.ossFile;
      if (obj.ossFile && typeof obj.ossFile === 'string') return obj.ossFile;
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') {
          const found = findOssFile(obj[key], (depth||0)+1);
          if (found) return found;
        }
      }
      return null;
    }

    const audioUrl = findOssFile(data, 0);
    console.log('Audio URL:', audioUrl ? audioUrl.substring(0, 100) : 'none');

    if (!audioUrl) {
      return res.status(500).json({ error: 'No audio in DupDub response', details: JSON.stringify(data).substring(0, 200) });
    }

    const audioRes = await fetch(audioUrl);
    const audioCt = audioRes.headers.get('content-type') || 'audio/mpeg';
    const audioBuffer = await audioRes.buffer();
    console.log('Audio size:', audioBuffer.length, '| Content-Type:', audioCt);

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
