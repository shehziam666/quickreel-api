const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const app = express();
app.use(cors());
app.use(express.json());
const limiter = rateLimit({ windowMs: 3600000, max: 20 });
function isValidUrl(url) {
  return /instagram\.com|tiktok\.com|youtube\.com\/shorts|youtu\.be/.test(url);
}
app.get('/', (req, res) => res.json({ status: 'QuickReel API is running' }));
app.get('/api/info', limiter, (req, res) => {
  const { url } = req.query;
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Invalid URL.' });
  exec(`yt-dlp --dump-json --no-playlist "${url}"`, { timeout: 20000 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: 'Could not fetch video info.' });
    try {
      const d = JSON.parse(stdout);
      res.json({ title: d.title || 'Video', thumbnail: d.thumbnail, uploader: d.uploader });
    } catch { res.status(500).json({ error: 'Parse error.' }); }
  });
});
app.get('/api/download', limiter, (req, res) => {
  const { url, quality = 'HD' } = req.query;
  if (!url || !isValidUrl(url)) return res.status(400).json({ error: 'Invalid URL.' });
  const isAudio = quality === 'MP3 Audio';
  const tmpFile = `/tmp/qr_${Date.now()}`;
  const outFile = isAudio ? `${tmpFile}.mp3` : `${tmpFile}.mp4`;
  const fmts = {
    'HD': 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '720p': 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best',
    '480p': 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best'
  };
  const fmt = fmts[quality] || fmts['HD'];
  const cmd = isAudio
    ? `yt-dlp -x --audio-format mp3 -o "${outFile}" "${url}"`
    : `yt-dlp -f "${fmt}" --merge-output-format mp4 -o "${outFile}" "${url}"`;
  exec(`yt-dlp --dump-json --no-playlist "${url}"`, { timeout: 20000 }, (e, stdout) => {
    let title = 'quickreel';
    if (!e && stdout) { try { title = JSON.parse(stdout).title || 'quickreel'; } catch {} }
    const safe = title.replace(/[^a-zA-Z0-9\s\-_]/g, '').replace(/\s+/g, '_').substring(0, 60) || 'quickreel';
    exec(cmd, { timeout: 120000 }, (err) => {
      if (err || !fs.existsSync(outFile)) return res.status(500).json({ error: 'Download failed.' });
      const ext = isAudio ? 'mp3' : 'mp4';
      res.setHeader('Content-Disposition', `attachment; filename="${safe}.${ext}"`);
      res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
      const stream = fs.createReadStream(outFile);
      stream.pipe(res);
      stream.on('end', () => fs.unlink(outFile, () => {}));
      stream.on('error', () => res.status(500).end());
    });
  });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`QuickReel API running on port ${PORT}`));
