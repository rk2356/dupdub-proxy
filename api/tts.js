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
    
    console.log('Speaker from frontend:', speaker, '| Language:', lang);

    // Resolve speaker: search DupDub API by name to get technical speaker ID
    let speakerId = null;
    const speakerName = (speaker || '').trim();
    
    if (speakerName) {
      try {
        // Search in the correct language
        const searchUrl = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?language=' + lang + '&pageSize=50';
        const searchRes = await fetch(searchUrl, { headers });
        const searchData = await searchRes.json();
        
        if (searchData.data && searchData.data.results && searchData.data.results.length > 0) {
          // Find exact match by display name (case-insensitive)
          const match = searchData.data.results.find(s => 
            s.name && s.name.toLowerCase() === speakerName.toLowerCase()
          );
          
          if (match) {
            speakerId = match.speaker;
            console.log('Found exact match:', speakerId, 'for', speakerName);
          } else {
            // Try partial match
            const partial = searchData.data.results.find(s => 
              s.name && s.name.toLowerCase().includes(speakerName.toLowerCase())
            );
            if (partial) {
              speakerId = partial.speaker;
              console.log('Found partial match:', speakerId, 'for', speakerName);
            }
          }
          
          // If Hindi text and no match found in Hindi, search all languages
          if (!speakerId && !isHindi) {
            // Try page 2
            const searchUrl2 = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?language=' + lang + '&pageSize=50&pageNum=2';
            const searchRes2 = await fetch(searchUrl2, { headers });
            const searchData2 = await searchRes2.json();
            if (searchData2.data && searchData2.data.results) {
              const match2 = searchData2.data.results.find(s => 
                s.name && s.name.toLowerCase() === speakerName.toLowerCase()
              );
              if (match2) {
                speakerId = match2.speaker;
                console.log('Found on page 2:', speakerId);
              }
            }
          }
          
          // If still no match, try searching ALL languages (no filter)
          if (!speakerId) {
            const searchUrlAll = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?pageSize=100';
            const searchResAll = await fetch(searchUrlAll, { headers });
            const searchDataAll = await searchResAll.json();
            if (searchDataAll.data && searchDataAll.data.results) {
              const matchAll = searchDataAll.data.results.find(s => 
                s.name && s.name.toLowerCase() === speakerName.toLowerCase()
              );
              if (matchAll) {
                speakerId = matchAll.speaker;
                console.log('Found in all-language search:', speakerId, 'lang:', matchAll.language);
              }
            }
          }
        }
      } catch (e) {
        console.log('Speaker search error:', e.message);
      }
    }

    // If still no speakerId, use first available speaker for the language
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
