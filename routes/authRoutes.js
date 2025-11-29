const express = require('express');
const router = express.Router();
const { signup, login, getMe, updateProfile } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public routes
router.post('/signup', signup);
router.post('/login', login);

// Protected routes (need token)
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);

module.exports = router;