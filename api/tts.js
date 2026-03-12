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

    // Always search for speaker to get real ID
    let speakerId = 'mercury_jane@hopeful'; // fallback
    const inputSpeaker = (speaker || '').toLowerCase().trim();

    if (inputSpeaker && inputSpeaker.includes('@')) {
      speakerId = inputSpeaker; // already in correct format
    } else if (inputSpeaker) {
      try {
        const searchUrl = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?language=English&domainId=1&gender=';
        const searchRes = await fetch(searchUrl, { headers });
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          const dataObj = searchData.data || searchData;
          let list = [];
          if (Array.isArray(dataObj)) list = dataObj;
          else if (dataObj && dataObj.list) list = dataObj.list;
          else if (dataObj && dataObj.records) list = dataObj.records;
          else if (dataObj && typeof dataObj === 'object') {
            // Try all array values
            for (const key of Object.keys(dataObj)) {
              if (Array.isArray(dataObj[key])) { list = dataObj[key]; break; }
            }
          }

          // Log structure for debugging
          console.log('Search data type:', typeof dataObj, 'keys:', dataObj ? Object.keys(dataObj).slice(0, 5) : 'null');
          if (list.length > 0) {
            console.log('Sample speakers:', list.slice(0, 3).map(s => JSON.stringify(s).substring(0, 150)));
            // Try to find matching speaker
            const found = list.find(s => {
              const allFields = JSON.stringify(s).toLowerCase();
              return allFields.includes(inputSpeaker);
            });
            if (found) {
              // Get the speaker field (the one used in API calls)
              speakerId = found.speaker || found.speakerId || found.speakerKey || found.id || speakerId;
              console.log('Matched speaker:', speakerId, 'from:', JSON.stringify(found).substring(0, 200));
            } else {
              console.log('No match for:', inputSpeaker, 'in', list.length, 'speakers');
            }
          } else {
            console.log('Empty speaker list. Raw keys:', JSON.stringify(searchData).substring(0, 300));
          }
        } else {
          console.log('Search API failed:', searchRes.status);
        }
      } catch (searchErr) {
        console.log('Search error:', searchErr.message);
      }
    }

    console.log('Final speaker:', speakerId, '| Input:', speaker);

    const payload = {
      speaker: speakerId,
      speed: speed || 1.0,
      pitch: pitch || 0,
      textList: finalTextList,
      source: 'web'
    };

    const r = await fetch('https://moyin-gateway.dupdub.com/tts/v1/playDemo/dubForSpeaker', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const contentType = r.headers.get('content-type') || '';

    if (contentType.includes('audio')) {
      const buffer = await r.buffer();
      res.setHeader('Content-Type', contentType);
      res.status(200).send(buffer);
    } else {
      const data = await r.json();
      console.log('DupDub TTS response:', JSON.stringify(data).substring(0, 500));
      // If speaker failed, return both error and debug info
      if (data.code && data.code !== 0) {
        return res.status(200).json({
          ...data,
          debug: { speakerUsed: speakerId, inputSpeaker: speaker }
        });
      }
      res.status(r.status).json(data);
    }
  } catch (err) {
    console.log('Proxy error:', err.message);
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
};
