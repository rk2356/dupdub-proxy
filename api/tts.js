const fetch = require('node-fetch');

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
    const allText = finalTextList.join(' ');
    const isHindi = hasHindi(allText);
    const lang = isHindi ? 'Hindi' : 'English';
    const speakerName = (speaker || '').trim();

    console.log('Speaker from frontend:', speakerName, '| Language:', lang);

    // Resolve speaker using keyword search for precise matching
    let speakerId = null;

    if (speakerName) {
      try {
        // Use keyword parameter to search for the exact speaker name
        const encodedName = encodeURIComponent(speakerName);
        const searchUrl = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?keyword=' + encodedName + '&pageSize=20';
        const searchRes = await fetch(searchUrl, { headers });
        const searchData = await searchRes.json();

        console.log('Keyword search for:', speakerName, '| Results:', searchData.data && searchData.data.results ? searchData.data.results.length : 0);

        if (searchData.data && searchData.data.results && searchData.data.results.length > 0) {
          // Log all results to debug
          searchData.data.results.forEach(s => {
            console.log('  Result:', s.name, '| speaker:', s.speaker ? s.speaker.substring(0, 40) : 'none');
          });

          // Find exact match by display name (case-insensitive)
          const match = searchData.data.results.find(s =>
            s.name && s.name.toLowerCase() === speakerName.toLowerCase()
          );

          if (match) {
            speakerId = match.speaker;
            console.log('Found exact match:', speakerId, 'Name:', match.name);
          } else {
            // Use first result from keyword search as best match
            speakerId = searchData.data.results[0].speaker;
            console.log('Using first keyword result:', speakerId, 'Name:', searchData.data.results[0].name);
          }
        }

        // If keyword search returned nothing, try broader search
        if (!speakerId) {
          const broadUrl = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?pageSize=800';
          const broadRes = await fetch(broadUrl, { headers });
          const broadData = await broadRes.json();
          if (broadData.data && broadData.data.results) {
            const m = broadData.data.results.find(s =>
              s.name && s.name.toLowerCase() === speakerName.toLowerCase()
            );
            if (m) {
              speakerId = m.speaker;
              console.log('Found in broad search:', speakerId, 'Name:', m.name);
            }
          }
        }
      } catch (e) {
        console.log('Speaker search error:', e.message);
      }
    }

    // Fallback: get first speaker for the language
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
