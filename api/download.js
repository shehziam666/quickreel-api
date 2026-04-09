const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const youtubeDlExec = require('youtube-dl-exec');

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

app.get('/', (req, res) => {
  res.json({ status: 'QuickReel API is running' });
});

app.get('/api/info', limiter, async (req, res) => {
  const { url } = req.query;
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid or unsupported URL.' });
  }

  try {
    const data = await youtubeDlExec(url, {
      dumpSingleJson: true,
      noPlaylist: true,
      noWarnings: true
    });
    res.json({
      title: data.title || 'Video',
      thumbnail: data.thumbnail,
      duration: data.duration,
      uploader: data.uploader || data.channel,
      platform: data.extractor_key
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch video info.', detail: err.message });
  }
});

app.get('/api/download', limiter, async (req, res) => {
  const { url, quality = 'HD' } = req.query;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid or unsupported URL.' });
  }

  const isAudio = quality === 'MP3 Audio';
  const tmpFile = `/tmp/qr_${Date.now()}`;
  const outFile = isAudio ? `${tmpFile}.mp3` : `${tmpFile}.mp4`;

  const formats = {
    'HD':   'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '720p': 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best',
    '480p': 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]/best'
  };

  try {
    if (isAudio) {
      await youtubeDlExec(url, {
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: 0,
        output: outFile
      });
    } else {
      const fmt = formats[quality] || formats['HD'];
      await youtubeDlExec(url, {
        format: fmt,
        mergeOutputFormat: 'mp4',
        output: outFile
      });
    }

    if (!fs.existsSync(outFile)) {
      return res.status(500).json({ error: 'Download failed. File not found after download.' });
    }

    const ext = isAudio ? 'mp3' : 'mp4';
    const mime = isAudio ? 'audio/mpeg' : 'video/mp4';
    res.setHeader('Content-Disposition', `attachment; filename="quickreel.${ext}"`);
    res.setHeader('Content-Type', mime);

    const stream = fs.createReadStream(outFile);
    stream.pipe(res);
    stream.on('end', () => fs.unlink(outFile, () => {}));
    stream.on('error', () => res.status(500).end());

  } catch (err) {
    res.status(500).json({ error: 'Download failed.', detail: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`QuickReel API running on port ${PORT}`);
});
