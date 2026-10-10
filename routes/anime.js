const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');

// Models
const Anime = require('../models/Anime');
const Episode = require('../models/Episode');
const Comment = require('../models/Comment');

// Rate limiter for comments - 5 comments per minute per IP
const commentLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 5,
    message: 'Too many comments. Please wait.',
});

// Helper: Validate MongoDB ID
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Helper: Sanitize comment - no HTML allowed
const cleanComment = (text) => sanitizeHtml(text.trim(), {
    allowedTags: [],
    allowedAttributes: {}
});

// Helper: Get guest identifier - uses session ID
const getGuestId = (req) => {
    if (!req.session.guestId) {
        req.session.guestId = 'guest_' + Math.random().toString(36).substring(2, 15);
    }
    return req.session.guestId;
};

// ==========================================
// PUBLIC VIEWS
// ==========================================

/**
 * GET /
 * Latest Releases Feed - PUBLIC
 */
router.get('/', async (req, res) => {
    try {
        // FIXED: Query Episodes directly. Limits to 12. O(1) performance instead of O(N).
        const latestEpisodesData = await Episode.find()
            .sort({ createdAt: -1 })
            .limit(12)
            .populate('anime', 'name imageUrl type')
            .lean();

        // Format to match exactly what your EJS template expects
        const latestEpisodes = latestEpisodesData.map(episode => ({
            ...episode,
            animeId: episode.anime ? episode.anime._id : null,
            animeTitle: episode.anime ? episode.anime.name : 'Unknown',
            animeImage: episode.anime ? episode.anime.imageUrl : '',
            seasonNumber: episode.seasonNumber,
            type: episode.anime ? episode.anime.type : 'series'
        }));

        res.render('latest-episodes', { latestEpisodes });
    } catch (error) {
        console.error('Latest episodes error:', error);
        res.status(500).render('404');
    }
});

/**
 * GET /:id
 * View Anime Details - PUBLIC: No login required
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidId(id)) {
            return res.status(404).render('404');
        }

        const anime = await Anime.findById(id)
          .populate('genres')
          .populate({
                path: 'seasons.episodes',
                model: 'Episode'
            });

        if (!anime) return res.status(404).render('404');

        // FIXED: Removed invalid '.populate("user")'. Replies and usernames are strings on the document.
        const comments = await Comment.find({ anime: id, parentComment: null })
          .populate('replies')
          .sort({ createdAt: -1 })
          .lean();

        // Suggested titles
        const randomAnimes = await Anime.aggregate([
            { $match: { _id: {$ne: new mongoose.Types.ObjectId(id) } } },
            { $sample: { size: 8 } }
        ]);

        res.render('anime-detail', {
            anime,
            comments,
            session: req.session,
            randomAnimes,
            guestId: getGuestId(req) // Pass guest ID to frontend
        });

    } catch (error) {
        console.error('View Anime Error:', error);
        res.status(500).render('404');
    }
});

// ==========================================
// USER INTERACTIONS (COMMENTS & RATINGS)
// ==========================================

/**
 * POST /rate/:id
 * Handle Anime Ratings
 */
router.post('/rate/:id', async (req, res) => {
    try {
        const { rating } = req.body; 
        const animeId = req.params.id;
        
        // Use user session ID if logged in, otherwise use their IP address to prevent spam
        const voterId = (req.session && req.session.userId) ? req.session.userId : req.ip; 

        if (!rating || rating < 2 || rating > 10) {
            return res.status(400).json({ success: false, message: 'Invalid rating value.' });
        }

        const anime = await Anime.findById(animeId);
        if (!anime) return res.status(404).json({ success: false, message: 'Anime not found.' });

        if (!anime.votedUsers) anime.votedUsers = [];
        if (typeof anime.ratingCount !== 'number') anime.ratingCount = 0;
        if (typeof anime.totalRatingSum !== 'number') anime.totalRatingSum = 0;

        // Block duplicate voting
        if (anime.votedUsers.includes(voterId)) {
            return res.json({ success: false, message: 'You have already voted for this anime!' });
        }

        // Calculate real mathematics for the rating
        anime.votedUsers.push(voterId);
        anime.ratingCount += 1;
        anime.totalRatingSum += rating;
        anime.ratingScore = anime.totalRatingSum / anime.ratingCount;

        await anime.save();

        const newPercentage = Math.round((anime.ratingScore / 10) * 100);

        res.json({
            success: true,
            newAverage: anime.ratingScore,
            newCount: anime.ratingCount,
            newPercentage: newPercentage
        });
        
    } catch (err) {
        console.error('Rating Error:', err);
        res.status(500).json({ success: false, message: 'Server error. Failed to save vote.' });
    }
});

/**
 * POST /comment/:animeId
 * Guest can comment - max 5 per anime
 */
router.post('/comment/:animeId', commentLimiter, async (req, res) => {
    const { animeId } = req.params;
    const { content, guestName, guestEmail } = req.body;

    if (!isValidId(animeId)) {
        req.flash('error', 'Invalid anime.');
        return res.redirect('/');
    }

    const cleanContent = cleanComment(content || '');
    const cleanName = cleanComment(guestName || '').substring(0, 50);
    const cleanEmail = (guestEmail || '').trim().toLowerCase();

    if (!cleanContent || cleanContent.length < 2) {
        req.flash('error', 'Comment too short.');
        return res.redirect(`/anime/${animeId}`);
    }

    if (!cleanName || cleanName.length < 2) {
        req.flash('error', 'Name is required.');
        return res.redirect(`/anime/${animeId}`);
    }

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        req.flash('error', 'Valid email is required.');
        return res.redirect(`/anime/${animeId}`);
    }

    if (cleanContent.length > 500) {
        req.flash('error', 'Comment too long. Max 500 characters.');
        return res.redirect(`/anime/${animeId}`);
    }

    try {
        const guestId = getGuestId(req);

        const userCommentCount = await Comment.countDocuments({
            anime: animeId,
            guestId: guestId,
            parentComment: null
        });

        if (userCommentCount >= 5) {
            req.flash('error', 'Comment limit reached at max 5. If you want to make another comment, delete an old comment first.');
            return res.redirect(`/anime/${animeId}`);
        }

        const comment = new Comment({
            anime: animeId,
            guestId: guestId,
            username: cleanName,
            guestEmail: cleanEmail,
            content: cleanContent,
            isAdmin: false
        });

        await comment.save();
        req.flash('success', 'Comment posted.');
        res.redirect(`/anime/${animeId}`);
    } catch (error) {
        console.error('Comment post error:', error);
        req.flash('error', 'Failed to post comment.');
        res.redirect(`/anime/${animeId}`);
    }
});

/**
 * POST /comment/reply/:animeId/:commentId
 * Guest can reply
 */
router.post('/comment/reply/:animeId/:commentId', commentLimiter, async (req, res) => {
    const { animeId, commentId } = req.params;
    const { content, guestName, guestEmail } = req.body;

    if (!isValidId(animeId) || !isValidId(commentId)) {
        req.flash('error', 'Invalid ID.');
        return res.redirect('/');
    }

    const cleanContent = cleanComment(content || '');
    const cleanName = cleanComment(guestName || '').substring(0, 50);
    const cleanEmail = (guestEmail || '').trim().toLowerCase();

    if (!cleanContent || cleanContent.length < 2) {
        req.flash('error', 'Reply too short.');
        return res.redirect(`/anime/${animeId}`);
    }

    if (!cleanName || cleanName.length < 2) {
        req.flash('error', 'Name is required.');
        return res.redirect(`/anime/${animeId}`);
    }

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        req.flash('error', 'Valid email is required.');
        return res.redirect(`/anime/${animeId}`);
    }

    try {
        const parent = await Comment.findById(commentId);
        if (!parent) {
            req.flash('error', 'Parent comment not found.');
            return res.redirect(`/anime/${animeId}`);
        }

        const guestId = getGuestId(req);

        const reply = new Comment({
            anime: animeId,
            guestId: guestId,
            username: cleanName,
            guestEmail: cleanEmail,
            content: cleanContent,
            parentComment: commentId,
            isAdmin: false
        });

        const savedReply = await reply.save();
        parent.replies.push(savedReply._id);
        await parent.save();

        req.flash('success', 'Reply posted.');
        res.redirect(`/anime/${animeId}`);
    } catch (error) {
        console.error('Reply error:', error);
        res.redirect(`/anime/${animeId}`);
    }
});

/**
 * POST /comment/delete/:animeId/:commentId
 * Guest can only delete their own comments - Admin can delete any
 */
router.post('/comment/delete/:animeId/:commentId', async (req, res) => {
    const { animeId, commentId } = req.params;

    if (!isValidId(animeId) || !isValidId(commentId)) {
        req.flash('error', 'Invalid ID.');
        return res.redirect('/');
    }

    try {
        const comment = await Comment.findById(commentId);
        if (!comment) return res.redirect(`/anime/${animeId}`);

        const isAdmin = !!req.session.isAdminAuthenticated;
        const guestId = getGuestId(req);
        const isOwner = comment.guestId === guestId;

        if (!isAdmin && !isOwner) {
            req.flash('error', 'You can only delete your own comments.');
            return res.redirect(`/anime/${animeId}`);
        }

        const cleanDelete = async (id) => {
            const replies = await Comment.find({ parentComment: id });
            for (const r of replies) {
                await cleanDelete(r._id);
                await Comment.findByIdAndDelete(r._id);
            }
        };

        await cleanDelete(commentId);

        if (comment.parentComment) {
            await Comment.findByIdAndUpdate(comment.parentComment, { $pull: { replies: commentId } });
        }

        await Comment.findByIdAndDelete(commentId);
        req.flash('success', 'Comment removed.');
        res.redirect(`/anime/${animeId}`);

    } catch (error) {
        console.error('Delete Comment Error:', error);
        res.redirect(`/anime/${animeId}`);
    }
});

module.exports = router;