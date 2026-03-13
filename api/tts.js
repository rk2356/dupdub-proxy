module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.json({status:'ok', message:'DupDub TTS Proxy running.'});

  const { apiKey, text, speakerName, speed, pitch } = req.body;
  if (!apiKey || !text) return res.status(400).json({error:'apiKey aur text required'});

  try {
    // Step 1: Lookup correct speaker ID by name
    let speaker = 'uranus_Adam'; // default fallback
    if (speakerName && speakerName !== 'Adam') {
      const searchUrl = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?pageSize=50&language=English';
      const searchRes = await fetch(searchUrl, {
        headers: { 'dupdub_token': apiKey, 'Content-Type': 'application/json' }
      });
      const searchData = await searchRes.json();
      if (searchData.code === 200 && searchData.data && searchData.data.results) {
        const found = searchData.data.results.find(s => s.name && s.name.toLowerCase() === speakerName.toLowerCase());
        if (found && found.speaker) {
          speaker = found.speaker;
        }
      }
    }

    // Step 2: Generate voice with correct speaker ID
    const r = await fetch('https://moyin-gateway.dupdub.com/tts/v1/playDemo/dubForSpeaker', {
      method: 'POST',
      headers: { 'dupdub_token': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ speaker: speaker, speed: String(speed || 1.0), pitch: String(pitch || 0), textList: [text] })
    });
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('audio') || ct.includes('octet') || ct.includes('wav') || ct.includes('mpeg')) {
      res.setHeader('Content-Type', ct);
      const buf = Buffer.from(await r.arrayBuffer());
      res.send(buf);
    } else {
      const data = await r.json();
      res.status(r.status).json(data);
    }
  } catch (e) {
    res.status(500).json({error: e.message});
  }
};
