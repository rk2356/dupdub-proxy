const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { token, keyword, page } = req.query;
  if (!token) return res.status(400).json({ error: 'token query param required' });

  const pageSize = 100;
  const pageNum = page || 1;
  let url = 'https://moyin-gateway.dupdub.com/tts/v1/storeSpeakerV2/searchSpeakerList?pageSize=' + pageSize + '&pageNum=' + pageNum;
  if (keyword) url += '&keyword=' + encodeURIComponent(keyword);

  const headers = { 'dupdub_token': token, 'Content-Type': 'application/json' };

  try {
    const r = await fetch(url, { headers });
    const data = await r.json();
    // Return simplified results
    if (data.data && data.data.results) {
      const simplified = data.data.results.map(s => ({
        name: s.name,
        speaker: s.speaker,
        speakerId: s.speakerId,
        gender: s.gender,
        quality: s.quality
      }));
      return res.status(200).json({
        total: data.data.totalElements,
        count: simplified.length,
        results: simplified
      });
    }
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
