const fetch = require('node-fetch');

function hasHindi(text) {
  return /[\u0900-\u097F]/.test(text);
}

async function findSpeakerId(speakerName, headers) {
  // Step 1: Search by keyword (fast, targeted)
  try {
    const keyword = encodeURIComponent(speakerName);
    const url = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?pageSize=20&keyword=' + keyword;
    console.log('Searching speaker by keyword:', speakerName);
    const res = await fetch(url, { headers });
    const data = await res.json();
    if (data.data && data.data.results && data.data.results.length > 0) {
      // Exact name match first
      const exact = data.data.results.find(s =>
        s.name && s.name.toLowerCase() === speakerName.toLowerCase()
      );
      if (exact) {
        console.log('Found exact match:', exact.name, '| speaker:', exact.speaker);
        return exact.speaker;
      }
      // Partial match fallback
      const partial = data.data.results.find(s =>
        s.name && s.name.toLowerCase().includes(speakerName.toLowerCase())
      );
      if (partial) {
        console.log('Found partial match:', partial.name, '| speaker:', partial.speaker);
        return partial.speaker;
      }
    }
  } catch (e) {
    console.log('Keyword search error:', e.message);
  }

  // Step 2: Try individual words as keywords
  const words = speakerName.split(/\s+/);
  for (const word of words) {
    if (word.length < 3) continue;
    try {
      const url = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?pageSize=50&keyword=' + encodeURIComponent(word);
      console.log('Trying word search:', word);
      const res = await fetch(url, { headers });
      const data = await res.json();
      if (data.data && data.data.results) {
        const match = data.data.results.find(s =>
          s.name && s.name.toLowerCase() === speakerName.toLowerCase()
        );
        if (match) {
          console.log('Found via word search:', match.name, '| speaker:', match.speaker);
          return match.speaker;
        }
      }
    } catch (e) {
      console.log('Word search error:', e.message);
    }
  }

  return null;
}

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
    const speakerName = (speaker || '').trim();
    console.log('Speaker from frontend:', speakerName);

    // Find speaker ID using keyword search
    let speakerId = null;
    if (speakerName) {
      speakerId = await findSpeakerId(speakerName, headers);
    }

    // Fallback: get first available speaker for language
    if (!speakerId) {
      const allText = finalTextList.join(' ');
      const lang = hasHindi(allText) ? 'Hindi' : 'English';
      console.log('No match for "' + speakerName + '". Getting first', lang, 'speaker...');
      try {
        const url = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?language=' + lang;
        const res2 = await fetch(url, { headers });
        const data2 = await res2.json();
        if (data2.data && data2.data.results && data2.data.results.length > 0) {
          speakerId = data2.data.results[0].speaker;
          console.log('Using fallback speaker:', speakerId);
        }
      } catch (e) {
        console.log('Fallback error:', e.message);
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

    // Retry on DupDub server error
    if (data.data && data.data.resList && data.data.resList[0] && !data.data.resList[0].success) {
      console.log('DupDub error, retrying in 2s...');
      await new Promise(r => setTimeout(r, 2000));
      result = await callTTS(headers, payload);
      if (result.type === 'audio') {
        res.setHeader('Content-Type', result.contentType);
        return res.status(200).send(result.buffer);
      }
      data = result.data;
      if (data.data && data.data.resList && data.data.resList[0] && !data.data.resList[0].success) {
        return res.status(500).json({ error: 'DupDub server error: ' + data.data.resList[0].message });
      }
    }

    if (data.code && data.code !== 200) {
      return res.status(400).json({ error: 'DupDub error: ' + (data.message || 'Unknown'), code: data.code });
    }

    // Find audio URL - only ossFile
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
