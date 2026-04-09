const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Please try again later.' }
});

function isValidUrl(url) {
  const allowed = [
    /instagram\.com\/reel\//,
    /instagram\.com\/p\//,
    /tiktok\.com\//,
    /youtube\.com\/shorts\//,
    /youtu\.be\//
  ];
  return allowed.some(p => p.test(url));
}

function safeFilename(title, ext) {
  const clean = (title || 'quickreel')
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 60);
  return `${clean || 'quickreel'}.${ext}`;
}

app.get('/', (req, res) => {
  res.json({ status: 'QuickReel API is running' });
});

app.get('/api/info', limiter, (req, res) => {
  const { url } = req.query;
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid or unsupported URL.' });
  }

  exec(`yt-dlp --dump-json --no-playlist "${url}"`, { timeout: 20000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: 'Could not fetch video info.', detail: stderr });
    try {
      const data = JSON.parse(stdout);
      res.json({
        title: data.title || 'Video',
        thumbnail: data.thumbnail,
        duration: data.duration,
        uploader: data.uploader || data.channel,
        platform: data.extractor_key
      });
    } catch {
      res.status(500).json({ error: 'Failed to parse video info.' });
    }
  });
});

app.get('/api/download', limiter, (req, res) => {
  const { url, quality = 'HD' } = req.query;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid or unsupported URL.' });
  }

  const formats = {
    'HD':        'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '720p':      'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best',
    '480p':      'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]/best',
    'MP3 Audio': 'bestaudio'
  };

  const isAudio = quality === 'MP3 Audio';
  const fmt = isAudio ? formats['MP3 Audio'] : (formats[quality] || formats['HD']);
  const tmpFile = `/tmp/qr_${Date.now()}`;
  const outFile = isAudio ? `${tmpFile}.mp3` : `${tmpFile}.mp4`;

  // First get the title, then download
  exec(`yt-dlp --dump-json --no-playlist "${url}"`, { timeout: 20000 }, (infoErr, infoStdout) => {
    let videoTitle = 'quickreel';
    if (!infoErr && infoStdout) {
      try {
        const info = JSON.parse(infoStdout);
        videoTitle = info.title || 'quickreel';
      } catch {}
    }

    let cmd;
    if (isAudio) {
      cmd = `yt-dlp -x --audio-format mp3 -o "${outFile}" "${url}"`;
    } else {
      cmd = `yt-dlp -f "${fmt}" --merge-output-format mp4 -o "${outFile}" "${url}"`;
    }

    exec(cmd, { timeout: 120000 }, (err) => {
      if (err || !fs.existsSync(outFile)) {
        return res.status(500).json({ error: 'Download failed. The video may be private.' });
      }
