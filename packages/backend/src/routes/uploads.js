const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const logger = require('../config/logger');

const router = express.Router();

router.use(requireUser);

// Ensure uploads directory exists
const UPLOAD_DIR = path.resolve(__dirname, '../../../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Accepted MIME types
const ACCEPTED_TYPES = {
  // Images (screenshots)
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  // Audio
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'audio/webm': 'audio',
  'audio/mp4': 'audio',
  'audio/aac': 'audio',
  // Video
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/ogg': 'video',
  'video/quicktime': 'video',
  'video/x-msvideo': 'video',
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not supported. Accepted: images, audio, and video files.`));
    }
  },
});

// POST / — Upload one or more files and attach to a project
// Returns array of attachment records (without linking to a message yet)
router.post(
  '/:projectId',
  upload.array('files', 10),
  async (req, res, next) => {
    try {
      const { projectId } = req.params;

      // Verify ownership
      const project = await db('projects')
        .where({ id: projectId, user_id: req.user.id })
        .first();
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const attachments = [];
      for (const file of req.files) {
        const category = ACCEPTED_TYPES[file.mimetype] || 'image';
        // For now, storage_url is a local path served statically.
        // In production, this would be an S3 URL.
        const storageUrl = `/uploads/${file.filename}`;

        const [attachment] = await db('message_attachments')
          .insert({
            message_id: null, // Will be linked when the message is sent
            project_id: projectId,
            filename: file.originalname,
            mime_type: file.mimetype,
            file_size: file.size,
            category,
            storage_url: storageUrl,
          })
          .returning('*');

        // The message_id is null constraint will fail — we need to make it nullable.
        // Actually, let's store these as "pending" attachments and link on message send.
        attachments.push(attachment);
      }

      logger.info('Files uploaded', {
        projectId,
        count: attachments.length,
        types: attachments.map((a) => a.category),
      });

      res.status(201).json({ attachments });
    } catch (err) {
      next(err);
    }
  }
);

// Error handler for multer
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 50 MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes('File type')) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Upload failed' });
});

module.exports = router;
