const express = require('express');
const router = express.Router();
const Anime = require('../models/Anime');
const Episode = require('../models/Episode');
const Comment = require('../models/Comment');
const { ensureAuthenticatedUser, ensureAuthenticatedAdmin } = require('../middleware/auth');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html');

// Rate limiter for comments - 5 comments per minute
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

/**
 * GET /:id
 * View Anime Details - NOW PROTECTED: Login required
 */
router.get('/:id', ensureAuthenticatedUser, async (req, res) => {
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

        // Fetch top-level comments and populate nested replies + users
        const comments = await Comment.find({ anime: id, parentComment: null })
            .populate('user', 'username')
            .populate({
                path: 'replies',
                populate: { path: 'user', select: 'username' }
            })
            .sort({ createdAt: -1 })
            .lean();

        // Suggested titles
        const randomAnimes = await Anime.aggregate([
            { $match: { _id: { $ne: new mongoose.Types.ObjectId(id) } } },
            { $sample: { size: 8 } }
        ]);

        res.render('anime-detail', {
            anime,
            comments,
            session: req.session,
            randomAnimes
        });

    } catch (error) {
        console.error('View Anime Error:', error);
        res.status(500).render('404');
    }
});

// ==========================================
// COMMENT SYSTEM (USER & ADMIN)
// ==========================================

/**
 * POST /comment/:animeId
 */
router.post('/comment/:animeId', ensureAuthenticatedUser, commentLimiter, async (req, res) => {
    const { animeId } = req.params;
    const { content } = req.body;

    if (!isValidId(animeId)) {
        req.flash('error', 'Invalid anime.');
        return res.redirect('/');
    }

    const cleanContent = cleanComment(content || '');
    if (!cleanContent || cleanContent.length < 2) {
        req.flash('error', 'Comment too short.');
        return res.redirect(`/anime/${animeId}`);
    }

    if (cleanContent.length > 500) {
        req.flash('error', 'Comment too long. Max 500 characters.');
        return res.redirect(`/anime/${animeId}`);
    }

    try {
        const comment = new Comment({
            anime: animeId,
            user: req.session.userId || req.session.adminId,
            username: req.session.username || req.session.adminUsername || 'Staff',
            content: cleanContent,
            isAdmin:!!req.session.isAdminAuthenticated
        });

        await comment.save();
        res.redirect(`/anime/${animeId}`);
    } catch (error) {
        console.error('Comment post error:', error);
        req.flash('error', 'Failed to post comment.');
        res.redirect(`/anime/${animeId}`);
    }
});

/**
 * POST /comment/reply/:animeId/:commentId
 */
router.post('/comment/reply/:animeId/:commentId', ensureAuthenticatedUser, commentLimiter, async (req, res) => {
    const { animeId, commentId } = req.params;
    const { content } = req.body;

    if (!isValidId(animeId) ||!isValidId(commentId)) {
        req.flash('error', 'Invalid ID.');
        return res.redirect('/');
    }

    const cleanContent = cleanComment(content || '');
    if (!cleanContent || cleanContent.length < 2) {
        req.flash('error', 'Reply too short.');
        return res.redirect(`/anime/${animeId}`);
    }

    try {
        const parent = await Comment.findById(commentId);
        if (!parent) {
            req.flash('error', 'Parent comment not found.');
            return res.redirect(`/anime/${animeId}`);
        }

        const reply = new Comment({
            anime: animeId,
            user: req.session.userId || req.session.adminId,
            username: req.session.username || req.session.adminUsername || 'Staff',
            content: cleanContent,
            parentComment: commentId,
            isAdmin:!!req.session.isAdminAuthenticated
        });

        const savedReply = await reply.save();
        parent.replies.push(savedReply._id);
        await parent.save();

        res.redirect(`/anime/${animeId}`);
    } catch (error) {
        console.error('Reply error:', error);
        res.redirect(`/anime/${animeId}`);
    }
});

/**
 * POST /comment/delete/:animeId/:commentId
 * Strict Security: Admin OR Owner only
 */
router.post('/comment/delete/:animeId/:commentId', ensureAuthenticatedUser, async (req, res) => {
    const { animeId, commentId } = req.params;

    if (!isValidId(animeId) ||!isValidId(commentId)) {
        req.flash('error', 'Invalid ID.');
        return res.redirect('/');
    }

    try {
        const comment = await Comment.findById(commentId);
        if (!comment) return res.redirect(`/anime/${animeId}`);

        const isAdmin =!!req.session.isAdminAuthenticated;
        const currentId = req.session.userId || req.session.adminId;
        const isOwner = currentId && comment.user && currentId.toString() === comment.user.toString();

        if (!isAdmin &&!isOwner) {
            req.flash('error', 'Security Violation: Unauthorized deletion attempt.');
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

// ==========================================
// ADMIN: CATALOG MANAGEMENT
// ==========================================

// FIXED: Now only needs episodeId, anime found automatically
router.post('/delete-episode/:episodeId', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { episodeId } = req.params;
        if (!isValidId(episodeId)) {
            req.flash('error', 'Invalid ID format.');
            return res.redirect('back');
        }

        const episode = await Episode.findById(episodeId);
        if (!episode) {
            req.flash('error', 'Episode not found.');
            return res.redirect('back');
        }

        const anime = await Anime.findOne({ 'seasons.episodes': episodeId });
        if (anime) {
            anime.seasons.forEach(season => {
                season.episodes = season.episodes.filter(ep => ep.toString()!== episodeId);
            });
            // Remove empty seasons
            anime.seasons = anime.seasons.filter(s => s.episodes.length > 0);
            await anime.save();
        }

        await Episode.findByIdAndDelete(episodeId);
        req.flash('success', 'Episode deleted.');
        res.redirect(anime? `/anime/${anime._id}` : '/admin/dashboard');
    } catch (error) {
        console.error('Delete episode error:', error);
        res.redirect('back');
    }
});

// FIXED: Simplified route - only episodeId needed
router.get('/edit-episode/:episodeId', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { episodeId } = req.params;
        if (!isValidId(episodeId)) {
            req.flash('error', 'Invalid ID.');
            return res.redirect('/admin/dashboard');
        }

        const episode = await Episode.findById(episodeId).lean();
        if (!episode) {
            req.flash('error', 'Episode not found.');
            return res.redirect('/admin/dashboard');
        }

        // Find parent anime
        const anime = await Anime.findOne({ 'seasons.episodes': episodeId }).lean();
        if (!anime) {
            req.flash('error', 'Parent anime not found.');
            return res.redirect('/admin/dashboard');
        }

        const season = anime.seasons.find(s => 
            s.episodes.some(ep => ep.toString() === episodeId)
        );

        res.render('admin-edit-episode', { 
            anime, 
            season, 
            episode,
            messages: req.flash()
        });
    } catch (error) {
        console.error('Edit episode GET error:', error);
        res.redirect('/admin/dashboard');
    }
});

// FIXED: Handle seasonNumber change + duplicate check + movie/series logic
router.post('/edit-episode/:episodeId', ensureAuthenticatedAdmin, async (req, res) => {
    const { episodeId } = req.params;
    const { title, videoUrl, imageUrl, embedCode, episodeNumber, seasonNumber } = req.body;

    if (!isValidId(episodeId)) {
        req.flash('error', 'Invalid ID.');
        return res.redirect('back');
    }

    try {
        const epNum = Number(episodeNumber);
        const sNum = Number(seasonNumber);

        if (!epNum ||!sNum || epNum < 1 || sNum < 1) {
            req.flash('error', 'Invalid season or episode number.');
            return res.redirect('back');
        }

        const oldEpisode = await Episode.findById(episodeId);
        if (!oldEpisode) {
            req.flash('error', 'Episode not found.');
            return res.redirect('back');
        }

        const anime = await Anime.findOne({ 'seasons.episodes': episodeId });
        if (!anime) {
            req.flash('error', 'Parent anime not found.');
            return res.redirect('back');
        }

        // For movies, force S1E1
        const finalSeasonNum = anime.type === 'movie'? 1 : sNum;
        const finalEpNum = anime.type === 'movie'? 1 : epNum;

        // Check duplicate if season/episode changed (skip for movies)
        if (anime.type!== 'movie' && (oldEpisode.seasonNumber!== finalSeasonNum || oldEpisode.episodeNumber!== finalEpNum)) {
            const targetSeason = anime.seasons.find(s => s.seasonNumber === finalSeasonNum);
            if (targetSeason) {
                const duplicate = await Episode.findOne({
                    _id: { $in: targetSeason.episodes, $ne: episodeId },
                    episodeNumber: finalEpNum
                });
                if (duplicate) {
                    req.flash('error', `Episode ${finalEpNum} already exists in Season ${finalSeasonNum}.`);
                    return res.redirect('back');
                }
            }
        }

        // Update episode
        await Episode.findByIdAndUpdate(episodeId, {
            title: title.trim(),
            videoUrl: videoUrl?.trim() || '',
            imageUrl: imageUrl?.trim() || '',
            embedCode: embedCode?.trim() || '',
            episodeNumber: finalEpNum,
            seasonNumber: finalSeasonNum
        });

        // If season changed, move episode to new season array
        if (oldEpisode.seasonNumber!== finalSeasonNum) {
            // Remove from old season
            anime.seasons.forEach(season => {
                season.episodes = season.episodes.filter(ep => ep.toString()!== episodeId);
            });
            // Remove empty seasons
            anime.seasons = anime.seasons.filter(s => s.episodes.length > 0);

            // Add to new season
            let newSeason = anime.seasons.find(s => s.seasonNumber === finalSeasonNum);
            if (!newSeason) {
                anime.seasons.push({ seasonNumber: finalSeasonNum, episodes: [episodeId] });
            } else {
                if (!newSeason.episodes.includes(episodeId)) {
                    newSeason.episodes.push(episodeId);
                }
            }
            await anime.save();
        }

        req.flash('success', `${anime.type === 'movie'? 'Movie' : 'Episode'} updated.`);
        res.redirect(`/anime/${anime._id}`);
    } catch (error) {
        console.error('Edit episode error:', error);
        req.flash('error', 'Update failed.');
        res.redirect('back');
    }
});

/**
 * GET /
 * Latest Releases Feed - PUBLIC
 */
router.get('/', async (req, res) => {
    try {
        const animes = await Anime.find({})
            .populate({ path: 'seasons.episodes', model: 'Episode' })
            .lean();

        const latestEpisodes = animes.flatMap(anime =>
            (anime.seasons || []).flatMap(season =>
                (season.episodes || []).map(episode => ({
               ...episode,
                    animeId: anime._id,
                    animeTitle: anime.name,
                    animeImage: anime.imageUrl,
                    seasonNumber: season.seasonNumber,
                    type: anime.type || 'series'
                }))
            )
        )
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 12);

        res.render('latest-episodes', { latestEpisodes });
    } catch (error) {
        console.error('Latest episodes error:', error);
        res.status(500).render('404');
    }
});

module.exports = router;