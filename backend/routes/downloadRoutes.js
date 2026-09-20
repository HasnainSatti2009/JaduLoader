const express = require('express');
const router = express.Router();

// Controller se functions ko import kiya
const {
    getVideoInfo,
    downloadVideo,
    downloadAudio,
    getSuggestions
} = require('../controllers/downloadController');

// Routes definitions
router.post('/info', getVideoInfo);
router.get('/suggest', getSuggestions);

// Video Routes
router.post('/download/video', downloadVideo);
router.get('/download/video', downloadVideo);

// Audio Routes
router.post('/download/audio', downloadAudio);
router.get('/download/audio', downloadAudio);

module.exports = router;