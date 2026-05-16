const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html'); // npm i sanitize-html express-rate-limit

// Rate limiter: 3 messages per hour per IP
const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    message: 'Too many contact requests. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Helper: Sanitize text - strip all HTML
const cleanText = (text) => sanitizeHtml(text.trim(), {
    allowedTags: [],
    allowedAttributes: {}
});

// Helper: Validate email
const isValidEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email) && email.length <= 254;
};

/**
 * LEGAL & INFO PAGES
 * No need to pass session or messages manually anymore; 
 * server.js handles them via res.locals.
 */

// DMCA Page
router.get('/dmca', (req, res) => {
    res.render('dmca');
});

// Privacy Policy Page
router.get('/privacy-policy', (req, res) => {
    res.render('privacy-policy');
});

// Disclaimer Page
router.get('/disclaimer', (req, res) => {
    res.render('disclaimer');
});

// ==========================================
// CONTACT SYSTEM
// ==========================================

// GET: View the Contact Form
router.get('/contact-us', (req, res) => {
    res.render('contact-us');
});

// POST: Handle Form Submission
router.post('/contact-us', contactLimiter, async (req, res) => {
    try {
        let { name, email, subject, message } = req.body;

        // 1. Sanitize all inputs
        name = cleanText(name || '');
        email = (email || '').trim().toLowerCase();
        subject = cleanText(subject || '');
        message = cleanText(message || '');

        // 2. Basic Validation
        if (!name ||!email ||!subject ||!message) {
            req.flash('error', 'All fields are required.');
            return res.redirect('/contact-us');
        }

        // 3. Length Validation
        if (name.length < 2 || name.length > 50) {
            req.flash('error', 'Name must be 2-50 characters.');
            return res.redirect('/contact-us');
        }
        if (!isValidEmail(email)) {
            req.flash('error', 'Invalid email format.');
            return res.redirect('/contact-us');
        }
        if (subject.length < 5 || subject.length > 100) {
            req.flash('error', 'Subject must be 5-100 characters.');
            return res.redirect('/contact-us');
        }
        if (message.length < 10 || message.length > 2000) {
            req.flash('error', 'Message must be 10-2000 characters.');
            return res.redirect('/contact-us');
        }

        // 4. Create Database Entry for Admin Dashboard
        await Contact.create({
            name,
            email,
            subject,
            message,
            ip: req.ip // Track IP for spam detection
        });

        req.flash('success', 'Transmission Received. Our team will analyze your report.');
        res.redirect('/contact-us');

    } catch (err) {
        console.error('Contact System Error:', err);
        req.flash('error', 'Signal Error: Message could not be delivered.');
        res.redirect('/contact-us');
    }
});

module.exports = router;