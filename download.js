// api/download.js
// Backend download handler using yt-dlp
// Deploy this on a VPS (DigitalOcean, Render, Railway, etc.)
// This file is the Express API. The frontend calls: GET /api/download?url=VIDEO_URL&quality=HD

const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// ===== RATE LIMITING =====
// Prevents abuse. 20 downloads per IP per hour.
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Please try again in an hour.' }
});

// ===== MIDDLEWARE =====
app.use(cors({ origin: 'https://quickreel.app' })); // your domain
app.use(express.static(path.join(__dirname, '..')));
app.use('/api/download', limiter);

// ===== QUALITY MAP =====
const qualityFormats = {
  'HD':    'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best',
  '720p':  'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best',
  '480p':  'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best',
  'MP3':   'bestaudio[ext=m4a]/bestaudio'
};

// ===== VALIDATE URL =====
function isValidVideoUrl(url) {
  const allowed = [
    /^https?:\/\/(www\.)?instagram\.com\/reel\//,
    /^https?:\/\/(www\.)?instagram\.com\/p\//,
    /^https?:\/\/(vm\.)?tiktok\.com\//,
    /^https?:\/\/(www\.)?tiktok\.com\/@.+\/video\//,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\//,
    /^https?:\/\/youtu\.be\//
  ];
  return allowed.some(pattern => pattern.test(url));
}

// ===== GET VIDEO INFO (no download) =====
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url || !isValidVideoUrl(url)) {
    return res.status(400).json({ error: 'Invalid or unsupported URL.' });
  }

  const safeUrl = url.replace(/[^a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]/g, '');
  const cmd = `yt-dlp --dump-json --no-playlist "${safeUrl}"`;

  exec(cmd, { timeout: 15000 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: 'Could not fetch video info.' });
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

// ===== DOWNLOAD ENDPOINT =====
app.get('/api/download', async (req, res) => {
  const { url, quality = 'HD' } = req.query;

  if (!url || !isValidVideoUrl(url)) {
    return res.status(400).json({ error: 'Invalid or unsupported URL.' });
  }

  const format = qualityFormats[quality] || qualityFormats['HD'];
  const isAudio = quality === 'MP3';
  const tmpFile = `/tmp/qr_${Date.now()}`;
  const outputFile = isAudio ? `${tmpFile}.mp3` : `${tmpFile}.mp4`;

  let cmd;
  if (isAudio) {
    cmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputFile}" "${url}"`;
  } else {
    cmd = `yt-dlp -f "${format}" --merge-output-format mp4 -o "${outputFile}" "${url}"`;
  }

  exec(cmd, { timeout: 60000 }, (err) => {
    if (err || !fs.existsSync(outputFile)) {
      return res.status(500).json({ error: 'Download failed. The video may be private or unavailable.' });
    }

    const mime = isAudio ? 'audio/mpeg' : 'video/mp4';
    const ext = isAudio ? 'mp3' : 'mp4';
    res.setHeader('Content-Disposition', `attachment; filename="quickreel_${Date.now()}.${ext}"`);
    res.setHeader('Content-Type', mime);

    const stream = fs.createReadStream(outputFile);
    stream.pipe(res);
    stream.on('end', () => { fs.unlink(outputFile, () => {}); });
    stream.on('error', () => { res.status(500).end(); });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`QuickReel API running on port ${PORT}`));
