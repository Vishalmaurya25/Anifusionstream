const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const { clearSessionCache } = require('../middleware/auth');

// Models
const Anime = require('../models/Anime');
const Episode = require('../models/Episode');
const Genre = require('../models/Genre');
const Admin = require('../models/Admin');
const Contact = require('../models/Contact');

// Middleware
const { ensureAuthenticatedAdmin } = require('../middleware/auth');

// Rate limiter for auth routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many attempts. Try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Helper: Validate MongoDB ID
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Helper: Escape regex special characters
const escapeRegex = (text) => {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};


// 1. AUTHENTICATION (LOGIN & REGISTER)


router.get('/login', (req, res) => {
    res.render('admin-login');
});

router.post('/login', authLimiter, async (req, res) => {
    try {
        let { username, password } = req.body;
        if (!username || !password) {
            req.flash('error', 'Administrator ID and Access Key are required.');
            return res.redirect('/admin/login');
        }

        username = username.toLowerCase().trim();
        const admin = await Admin.findOne({ username });

        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            req.flash('error', 'Invalid security credentials.');
            return res.redirect('/admin/login');
        }

        req.session.isAdminAuthenticated = true;
        req.session.adminId = admin._id.toString();
        req.session.adminUsername = admin.username;

        req.session.save(() => {
            req.flash('success', 'Authorization successful. Welcome back.');
            res.redirect('/admin/dashboard');
        });
    } catch (err) {
        console.error("Admin Login Error:", err);
        req.flash('error', 'Security system failure.');
        res.redirect('/admin/login');
    }
});

router.get('/register', (req, res) => {
    res.render('admin-register');
});

router.post('/register', authLimiter, async (req, res) => {
    try {
        let { username, password, confirmPassword, adminCode } = req.body;

        if (!process.env.ADMIN_CODE || adminCode !== process.env.ADMIN_CODE) {
            req.flash('error', 'Access Denied: Invalid Master Admin Code.');
            return res.redirect('/admin/register');
        }

        if (password !== confirmPassword) {
            req.flash('error', 'Security Alert: Passwords do not match.');
            return res.redirect('/admin/register');
        }

        if (password.length < 8) {
            req.flash('error', 'Key Strength: Password must be at least 8 characters.');
            return res.redirect('/admin/register');
        }

        username = username.toLowerCase().trim();
        if (await Admin.findOne({ username })) {
            req.flash('error', 'ID Conflict: Administrator already exists.');
            return res.redirect('/admin/register');
        }

        const hashed = await bcrypt.hash(password, 12);
        await Admin.create({ username, password: hashed });

        req.flash('success', 'Registration authorized. Please login to your new console.');
        res.redirect('/admin/login');
    } catch (err) {
        console.error("Admin Register Error:", err);
        req.flash('error', 'System registration failed.');
        res.redirect('/admin/register');
    }
});


// 2. PASSWORD RECOVERY (FORGOT/RESET)


router.get('/forgot-password', (req, res) => {
    res.render('admin-forgot-password');
});

router.post('/forgot-password', authLimiter, async (req, res) => {
    try {
        const { username, adminCode } = req.body;
        if (!process.env.ADMIN_CODE || adminCode !== process.env.ADMIN_CODE) {
            req.flash('error', 'Security Violation: Invalid Master Code.');
            return res.redirect('/admin/forgot-password');
        }

        const admin = await Admin.findOne({ username: username.toLowerCase().trim() });
        if (!admin) {
            req.flash('error', 'ID Not Found: Administrator does not exist.');
            return res.redirect('/admin/forgot-password');
        }

        req.session.canResetAdminPassword = true;
        req.session.resetAdminUsername = admin.username;

        req.session.save(() => {
            req.flash('success', 'Identity confirmed. Proceeding to Key Reset.');
            res.redirect('/admin/reset-password');
        });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.redirect('/admin/forgot-password');
    }
});

router.get('/reset-password', (req, res) => {
    if (!req.session.canResetAdminPassword || !req.session.resetAdminUsername) {
        req.flash('error', 'Session expired. Start again.');
        return res.redirect('/admin/forgot-password');
    }
    res.render('admin-reset-password');
});

router.post('/reset-password', async (req, res) => {
    try {
        if (!req.session.canResetAdminPassword || !req.session.resetAdminUsername) {
            req.flash('error', 'Session expired.');
            return res.redirect('/admin/forgot-password');
        }

        const { password, confirmPassword } = req.body;
        const username = req.session.resetAdminUsername;

        if (password !== confirmPassword) {
            req.flash('error', 'Passwords do not match.');
            return res.redirect('/admin/reset-password');
        }

        if (!password || password.length < 8) {
            req.flash('error', 'Key Insufficient: Security length not met.');
            return res.redirect('/admin/reset-password');
        }

        const hashed = await bcrypt.hash(password, 12);
        await Admin.findOneAndUpdate({ username }, { password: hashed });

        delete req.session.canResetAdminPassword;
        delete req.session.resetAdminUsername;

        req.session.save(() => {
            req.flash('success', 'Master access key updated. System relogin required.');
            res.redirect('/admin/login');
        });
    } catch (err) {
        console.error('Reset password error:', err);
        res.redirect('/admin/reset-password');
    }
});


// 3. DASHBOARD & SYSTEM MONITORING


router.get('/dashboard', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        // --- SEARCH, FILTER, AND PAGINATION ---
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 20; // 20 anime per page
        const skip = (page - 1) * limit;
        
        const searchQuery = req.query.q ? req.query.q.trim() : '';
        const filterQuery = req.query.filter || 'all';

        let query = {};

        if (searchQuery) {
            query.name = { $regex: escapeRegex(searchQuery), $options: 'i' };
        }

        // Precise Filter Logic
        switch (filterQuery) {
            case 'series_all':
                query.type = 'series';
                break;
            case 'series_with_ep':
                query.type = 'series';
                query.seasons = { $elemMatch: { 'episodes.0': { $exists: true } } };
                break;
            case 'series_without_ep':
                query.type = 'series';
                query.seasons = { $not: { $elemMatch: { 'episodes.0': { $exists: true } } } };
                break;
            case 'movie_all':
                query.type = 'movie';
                break;
            case 'movie_with_ep':
                query.type = 'movie';
                query.seasons = { $elemMatch: { 'episodes.0': { $exists: true } } };
                break;
            case 'movie_without_ep':
                query.type = 'movie';
                query.seasons = { $not: { $elemMatch: { 'episodes.0': { $exists: true } } } };
                break;
        }

        // Execute parallel queries for performance
        const [totalAnimes, userMessages, animes] = await Promise.all([
            Anime.countDocuments(query),
            Contact.find().sort({ createdAt: -1 }).lean(),
            Anime.find(query)
                .populate('genres')
                .populate({ path: 'seasons.episodes', model: 'Episode' })
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean()
        ]);

        const totalPages = Math.ceil(totalAnimes / limit) || 1;

        // Sort seasons and episodes within the fetched data
        animes.forEach(anime => {
            if (anime.seasons) {
                anime.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
                anime.seasons.forEach(season => {
                    if (season.episodes) {
                        season.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
                    }
                });
            }
        });

        res.render('admin-dashboard', {
            animes: animes || [],
            userMessages: userMessages || [],
            currentPage: page,
            totalPages,
            totalAnimes,
            searchQuery,
            currentFilter: filterQuery
        });
    } catch (err) {
        console.error("Dashboard Error:", err);
        res.status(500).send("Critical Core Failure");
    }
});

router.post('/delete-message/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid ID format.');
            return res.redirect('/admin/dashboard');
        }
        await Contact.findByIdAndDelete(req.params.id);
        req.flash('success', 'Intelligence report cleared.');
    } catch (err) {
        req.flash('error', 'Protocol failure: Could not delete report.');
    }
    res.redirect('/admin/dashboard');
});


// 4. ANIME MANAGEMENT (CRUD)


router.get('/add-anime', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const genres = await Genre.find().lean();
        res.render('admin-add-anime', { genres });
    } catch (err) {
        res.redirect('/admin/dashboard');
    }
});

router.post('/add-anime', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { name, imageUrl, description, genres, specialInfo, type } = req.body;

        if (!name || !name.trim()) {
            req.flash('error', 'Anime name is required.');
            return res.redirect('/admin/add-anime');
        }

        const trimmedName = name.trim();

        const existingAnime = await Anime.findOne({
            name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') }
        });

        if (existingAnime) {
            req.flash('error', `Duplicate detected: "${trimmedName}" already exists in catalog.`);
            return res.redirect('/admin/add-anime');
        }

        await Anime.create({
            name: trimmedName,
            imageUrl: imageUrl?.trim() || '',
            description: description?.trim() || '',
            specialInfo: specialInfo?.trim() || '',
            genres: Array.isArray(genres) ? genres : (genres ? [genres] : []),
            type: type || 'series'
        });

        req.flash('success', 'Catalog Updated: New anime title initialized.');
        res.redirect('/admin/dashboard');

    } catch (err) {
        console.error('Add anime error:', err);

        if (err.code === 11000) {
            req.flash('error', `Protocol failure: "${req.body.name}" already exists (duplicate key).`);
            return res.redirect('/admin/add-anime');
        }

        req.flash('error', 'Protocol failure: Anime not added - ' + err.message);
        res.redirect('/admin/add-anime');
    }
});

router.get('/edit-anime/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid anime ID.');
            return res.redirect('/admin/dashboard');
        }
        const anime = await Anime.findById(req.params.id).populate('genres').lean();
        const genres = await Genre.find().lean();
        if (!anime) return res.redirect('/admin/dashboard');
        res.render('admin-edit-anime', { anime, genres });
    } catch (err) {
        res.redirect('/admin/dashboard');
    }
});

router.post('/edit-anime/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid anime ID.');
            return res.redirect('/admin/dashboard');
        }

        const { name, imageUrl, description, genres, specialInfo, type } = req.body;
        const trimmedName = name.trim();

        const duplicate = await Anime.findOne({
            _id: { $ne: req.params.id },
            name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') }
        });

        if (duplicate) {
            req.flash('error', `Name conflict: "${trimmedName}" already used by another anime.`);
            return res.redirect(`/admin/edit-anime/${req.params.id}`);
        }

        await Anime.findByIdAndUpdate(req.params.id, {
            name: trimmedName,
            imageUrl: imageUrl?.trim() || '',
            description: description?.trim() || '',
            specialInfo: specialInfo?.trim() || '',
            genres: Array.isArray(genres) ? genres : (genres ? [genres] : []),
            type: type || 'series',
            updatedAt: new Date()
        });

        req.flash('success', 'Metadata Refined: Anime details saved.');
        res.redirect('/admin/dashboard');

    } catch (err) {
        console.error('Edit anime error:', err);

        if (err.code === 11000) {
            req.flash('error', 'Duplicate name detected.');
            return res.redirect(`/admin/edit-anime/${req.params.id}`);
        }

        req.flash('error', 'Catalog Error: Update failed.');
        res.redirect('/admin/dashboard');
    }
});

router.post('/delete-anime/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid anime ID.');
            return res.redirect('/admin/dashboard');
        }
        const anime = await Anime.findById(req.params.id);
        if (anime) {
            for (const season of anime.seasons) {
                await Episode.deleteMany({ _id: { $in: season.episodes } });
            }
            await anime.deleteOne();
            req.flash('success', 'Wiped: Title and associated data removed.');
        }
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error('Delete anime error:', err);
        req.flash('error', 'Wipe Protocol Failure.');
        res.redirect('/admin/dashboard');
    }
});


// 5. EPISODE MANAGEMENT (CRUD)


router.get('/add-episode/:animeId', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.animeId)) {
            req.flash('error', 'Invalid anime ID.');
            return res.redirect('/admin/dashboard');
        }
        const anime = await Anime.findById(req.params.animeId).lean();
        if (!anime) {
            req.flash('error', 'Anime not found');
            return res.redirect('/admin/dashboard');
        }
        res.render('admin-add-episode', { anime });
    } catch (err) {
        console.error('Get Add Episode Error:', err);
        req.flash('error', 'Something went wrong');
        res.redirect('/admin/dashboard');
    }
});

router.post('/add-episode/:animeId', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { animeId } = req.params;
        let { seasonNumber, episodeNumber, title, videoUrl, imageUrl, embedCode } = req.body;

        if (!isValidId(animeId)) {
            req.flash('error', 'Invalid anime ID in URL');
            return res.redirect('/admin/dashboard');
        }

        const anime = await Anime.findById(animeId);
        if (!anime) {
            req.flash('error', 'Anime not found in database');
            return res.redirect('/admin/dashboard');
        }

        title = title?.trim();
        videoUrl = videoUrl?.trim() || '';
        embedCode = embedCode?.trim() || '';
        imageUrl = imageUrl?.trim() || '';

        if (!title) {
            req.flash('error', 'Episode title is required');
            return res.redirect(`/admin/add-episode/${animeId}`);
        }

        if (!videoUrl && !embedCode) {
            req.flash('error', 'Either Video URL or Embed Code is required');
            return res.redirect(`/admin/add-episode/${animeId}`);
        }

        const season = anime.type === 'movie' ? 1 : parseInt(seasonNumber);
        const episode = anime.type === 'movie' ? 1 : parseInt(episodeNumber);

        if (isNaN(season) || isNaN(episode) || season < 1 || episode < 1) {
            req.flash('error', 'Invalid season or episode number');
            return res.redirect(`/admin/add-episode/${animeId}`);
        }

        const existingSeason = anime.seasons.find(s => s.seasonNumber === season);
        if (existingSeason) {
            const duplicateCheck = await Episode.findOne({
                _id: { $in: existingSeason.episodes },
                episodeNumber: episode
            });

            if (duplicateCheck) {
                req.flash('error', `Season ${season} Episode ${episode} already exists`);
                return res.redirect(`/admin/add-episode/${animeId}`);
            }
        }

        const newEpisode = await Episode.create({
            title,
            seasonNumber: season,
            episodeNumber: episode,
            imageUrl,
            videoUrl,
            embedCode,
            anime: animeId
        });

        let seasonObj = anime.seasons.find(s => s.seasonNumber === season);

        if (!seasonObj) {
            anime.seasons.push({
                seasonNumber: season,
                episodes: [newEpisode._id]
            });
        } else {
            seasonObj.episodes.push(newEpisode._id);
        }

        anime.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
        await anime.save();

        req.flash('success', `Deployment Success: S${season} E${episode} is live.`);
        res.redirect('/admin/dashboard');

    } catch (err) {
        console.error('Add Episode Error:', err);

        if (err.name === 'ValidationError') {
            const errors = Object.values(err.errors).map(e => e.message);
            req.flash('error', `Validation Error: ${errors.join(', ')}`);
        } else if (err.code === 11000) {
            req.flash('error', 'This episode already exists in this season');
        } else {
            req.flash('error', 'Deployment Failed: ' + err.message);
        }

        res.redirect(`/admin/add-episode/${req.params.animeId}`);
    }
});

router.get('/edit-episode/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid episode ID.');
            return res.redirect('/admin/dashboard');
        }
        const episodeId = req.params.id;
        const episode = await Episode.findById(episodeId).lean();
        if (!episode) {
            req.flash('error', 'Signal Lost: Episode not found.');
            return res.redirect('/admin/dashboard');
        }

        const anime = await Anime.findOne({ "seasons.episodes": episodeId }).lean();
        const season = anime ? anime.seasons.find(s =>
            s.episodes.some(e => e.toString() === episodeId)
        ) : null;

        res.render('admin-edit-episode', { episode, anime, season });
    } catch (err) {
        console.error("Episode Edit GET Error:", err);
        res.redirect('/admin/dashboard');
    }
});

router.post('/edit-episode/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid episode ID.');
            return res.redirect('/admin/dashboard');
        }

        let { episodeNumber, seasonNumber, title, videoUrl, imageUrl, embedCode } = req.body;
        const episodeId = req.params.id;

        title = title?.trim();
        videoUrl = videoUrl?.trim() || '';
        embedCode = embedCode?.trim() || '';
        imageUrl = imageUrl?.trim() || '';

        const newSeason = parseInt(seasonNumber);
        const newEpisodeNum = parseInt(episodeNumber);

        if (!title || isNaN(newSeason) || isNaN(newEpisodeNum) || newSeason < 1 || newEpisodeNum < 1) {
            req.flash('error', 'Invalid season, episode number or title.');
            return res.redirect(`/admin/edit-episode/${episodeId}`);
        }

        if (!videoUrl && !embedCode) {
            req.flash('error', 'Either Video URL or Embed Code is required');
            return res.redirect(`/admin/edit-episode/${episodeId}`);
        }

        const oldEpisode = await Episode.findById(episodeId);
        if (!oldEpisode) {
            req.flash('error', 'Episode not found.');
            return res.redirect('/admin/dashboard');
        }

        const oldSeasonNumber = oldEpisode.seasonNumber;
        const oldEpisodeNumber = oldEpisode.episodeNumber;

        const anime = await Anime.findOne({ "seasons.episodes": episodeId });
        if (!anime) {
            req.flash('error', 'Parent anime not found.');
            return res.redirect('/admin/dashboard');
        }

        const finalSeasonNum = anime.type === 'movie' ? 1 : newSeason;
        const finalEpNum = anime.type === 'movie' ? 1 : newEpisodeNum;

        if (anime.type !== 'movie' && (oldSeasonNumber !== finalSeasonNum || oldEpisodeNumber !== finalEpNum)) {
            const targetSeason = anime.seasons.find(s => s.seasonNumber === finalSeasonNum);
            if (targetSeason) {
                const duplicateCheck = await Episode.findOne({
                    _id: { $in: targetSeason.episodes, $ne: episodeId },
                    episodeNumber: finalEpNum
                });

                if (duplicateCheck) {
                    req.flash('error', `Season ${finalSeasonNum} Episode ${finalEpNum} already exists`);
                    return res.redirect(`/admin/edit-episode/${episodeId}`);
                }
            }
        }

        await Episode.findByIdAndUpdate(episodeId, {
            episodeNumber: finalEpNum,
            seasonNumber: finalSeasonNum,
            title,
            videoUrl,
            imageUrl,
            embedCode
        });

        if (oldSeasonNumber !== finalSeasonNum) {
            await Anime.updateOne(
                { _id: anime._id, "seasons.seasonNumber": oldSeasonNumber },
                { $pull: { "seasons.$.episodes": episodeId } }
            );

            await Anime.updateOne(
                { _id: anime._id },
                { $pull: { seasons: { episodes: { $size: 0 } } } }
            );

            const seasonExists = await Anime.findOne({
                _id: anime._id,
                "seasons.seasonNumber": finalSeasonNum
            });

            if (seasonExists) {
                await Anime.updateOne(
                    { _id: anime._id, "seasons.seasonNumber": finalSeasonNum },
                    { $addToSet: { "seasons.$.episodes": episodeId } }
                );
            } else {
                await Anime.updateOne(
                    { _id: anime._id },
                    {
                        $push: {
                            seasons: {
                                seasonNumber: finalSeasonNum,
                                episodes: [episodeId]
                            }
                        }
                    }
                );
            }

            const updatedAnime = await Anime.findById(anime._id);
            updatedAnime.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
            await updatedAnime.save();
        }

        req.flash('success', `Episode updated: S${finalSeasonNum} E${finalEpNum}`);
        res.redirect('/admin/dashboard');

    } catch (err) {
        console.error('Edit episode error:', err);
        if (err.code === 11000) {
            req.flash('error', 'This episode number already exists in this season');
        } else {
            req.flash('error', 'Re-encryption failed: ' + err.message);
        }
        res.redirect(`/admin/edit-episode/${req.params.id}`);
    }
});

router.post('/delete-episode/:episodeId', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { episodeId } = req.params;

        if (!isValidId(episodeId)) {
            req.flash('error', 'Invalid ID format.');
            return res.redirect('/admin/dashboard');
        }

        const episode = await Episode.findById(episodeId);
        if (!episode) {
            req.flash('error', 'Episode not found.');
            return res.redirect('/admin/dashboard');
        }

        const anime = await Anime.findOne({ 'seasons.episodes': episodeId });
        if (anime) {
            anime.seasons.forEach(season => {
                season.episodes = season.episodes.filter(ep => ep.toString() !== episodeId);
            });
            anime.seasons = anime.seasons.filter(s => s.episodes.length > 0);
            await anime.save();
        }

        await Episode.findByIdAndDelete(episodeId);
        req.flash('success', 'Episode deleted successfully.');
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error('Delete episode error:', err);
        req.flash('error', 'Operation failure: ' + err.message);
        res.redirect('/admin/dashboard');
    }
});

router.post('/delete-season/:animeId/:seasonId', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { animeId, seasonId } = req.params;

        if (!isValidId(animeId) || !isValidId(seasonId)) {
            req.flash('error', 'Invalid ID format.');
            return res.redirect('/admin/dashboard');
        }

        const anime = await Anime.findById(animeId);
        if (!anime) {
            req.flash('error', 'Anime not found.');
            return res.redirect('/admin/dashboard');
        }

        const season = anime.seasons.id(seasonId);
        if (!season) {
            req.flash('error', 'Season not found.');
            return res.redirect('/admin/dashboard');
        }

        const seasonNumber = season.seasonNumber;
        const episodeCount = season.episodes.length;

        if (season.episodes && season.episodes.length > 0) {
            await Episode.deleteMany({ _id: { $in: season.episodes } });
            console.log(`✅ Deleted ${episodeCount} episodes from Season ${seasonNumber}`);
        }

        anime.seasons = anime.seasons.filter(s => s._id.toString() !== seasonId);
        await anime.save();

        req.flash('success', `Season ${seasonNumber} and ${episodeCount} episodes deleted successfully.`);
        res.redirect('/admin/dashboard');

    } catch (err) {
        console.error('Delete season error:', err);
        req.flash('error', 'Failed to delete season: ' + err.message);
        res.redirect('/admin/dashboard');
    }
});


// 6. GENRE MANAGEMENT (CATEGORIES)


router.get('/manage-categories', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const genres = await Genre.aggregate([
            {
                $addFields: {
                    isLatest: {
                        $cond: {
                            if: { $regexMatch: { input: "$name", regex: /latest/i } },
                            then: 0,
                            else: 1
                        }
                    }
                }
            },
            {
                $sort: {
                    isLatest: 1,
                    sequence: 1,
                    name: 1
                }
            }
        ]);
        res.render('admin-manage-categories', { genres });
    } catch (err) {
        res.redirect('/admin/dashboard');
    }
});

router.post('/add-genre', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const name = req.body.name?.trim();
        if (!name) {
            req.flash('error', 'Category name required.');
            return res.redirect('/admin/manage-categories');
        }
        if (await Genre.findOne({ name })) {
            req.flash('error', 'Category already exists.');
            return res.redirect('/admin/manage-categories');
        }
        await Genre.create({ name, sequence: 9999 });
        req.flash('success', 'New Category Blueprint added.');
    } catch (err) {
        req.flash('error', 'Failed to add category.');
    }
    res.redirect('/admin/manage-categories');
});

router.post('/edit-genre/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid category ID.');
            return res.redirect('/admin/manage-categories');
        }
        await Genre.findByIdAndUpdate(req.params.id, { name: req.body.name.trim() });
        req.flash('success', 'Category recalibrated.');
    } catch (err) {
        req.flash('error', 'Recalibration failed.');
    }
    res.redirect('/admin/manage-categories');
});

router.post('/delete-genre/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid category ID.');
            return res.redirect('/admin/manage-categories');
        }
        const id = req.params.id;
        await Genre.findByIdAndDelete(id);
        await Anime.updateMany({ genres: id }, { $pull: { genres: id } });
        req.flash('success', 'Category Updated from all linked titles.');
    } catch (err) {
        req.flash('error', 'Purge failed.');
    }
    res.redirect('/admin/manage-categories');
});

router.post('/update-genre-sequence/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            req.flash('error', 'Invalid category ID.');
            return res.redirect('/admin/manage-categories');
        }
        const sequence = req.body.sequence ? parseInt(req.body.sequence) : 9999;

        if (sequence < 1 || sequence > 999) {
            req.flash('error', 'Sequence must be between 1-999.');
            return res.redirect('/admin/manage-categories');
        }

        await Genre.findByIdAndUpdate(req.params.id, { sequence });
        req.flash('success', 'Category sequence updated.');
    } catch (err) {
        req.flash('error', 'Sequence update failed.');
    }
    res.redirect('/admin/manage-categories');
});


// 7. TERMINATE SESSION (LOGOUT)

router.post('/logout', (req, res) => {
    const sessionId = req.session?.id;

    req.session.destroy((err) => {
        if (err) {
            console.error("Admin Session Deconstruction Error:", err);
        }
        clearSessionCache(sessionId);
        res.clearCookie('connect.sid', { path: '/' });
        res.redirect('/admin/login');
    });
});

module.exports = router;