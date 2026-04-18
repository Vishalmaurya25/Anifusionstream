const express = require('express');
const router = express.Router();
const Anime = require('../models/Anime');
const Episode = require('../models/Episode');
const Genre = require('../models/Genre');
const Admin = require('../models/Admin');
const Contact = require('../models/Contact'); 
const bcrypt = require('bcryptjs');
const { ensureAuthenticatedAdmin } = require('../middleware/auth');

// --- 1. AUTHENTICATION (LOGIN) ---

router.get('/login', (req, res) => {
    res.render('admin-login', { messages: req.flash(), session: req.session });
});

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const admin = await Admin.findOne({ username });
        
        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            req.flash('error', 'Invalid Administrator Credentials');
            return res.redirect('/admin/login');
        }

        req.session.isAdminAuthenticated = true;
        req.session.adminUsername = admin.username; 
        res.redirect('/admin/dashboard');
    } catch (err) {
        req.flash('error', 'Login system error');
        res.redirect('/admin/login');
    }
});

// --- 2. REGISTRATION (WITH ADMIN CODE) ---

router.get('/register', (req, res) => {
    res.render('admin-register', { messages: req.flash(), session: req.session });
});

router.post('/register', async (req, res) => {
    try {
        const { username, password, confirmPassword, adminCode } = req.body;

        // Verify Master Admin Code from .env
        if (adminCode !== process.env.ADMIN_CODE) {
            req.flash('error', 'Unauthorized: Invalid Master Admin Code');
            return res.redirect('/admin/register');
        }

        if (password !== confirmPassword) {
            req.flash('error', 'Passwords do not match');
            return res.redirect('/admin/register');
        }

        const existingAdmin = await Admin.findOne({ username });
        if (existingAdmin) {
            req.flash('error', 'Username already exists in system');
            return res.redirect('/admin/register');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newAdmin = new Admin({
            username,
            password: hashedPassword
        });

        await newAdmin.save();
        req.flash('success', 'Admin registered successfully. Please login.');
        res.redirect('/admin/login');
    } catch (err) {
        req.flash('error', 'Registration system error');
        res.redirect('/admin/register');
    }
});

// --- 3. FORGOT PASSWORD (STEP 1: IDENTITY VERIFY) ---

router.get('/forgot-password', (req, res) => {
    res.render('admin-forgot-password', { messages: req.flash(), session: req.session });
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { username, adminCode } = req.body;

        // Check Admin Code
        if (adminCode !== process.env.ADMIN_CODE) {
            req.flash('error', 'Security Verification Failed: Invalid Code');
            return res.redirect('/admin/forgot-password');
        }

        const admin = await Admin.findOne({ username });
        if (!admin) {
            req.flash('error', 'Admin record not found');
            return res.redirect('/admin/forgot-password');
        }

        // Set session permissions to access the reset page
        req.session.canResetAdminPassword = true;
        req.session.resetAdminUsername = username;

        res.redirect('/admin/reset-password');
    } catch (err) {
        req.flash('error', 'Recovery system error');
        res.redirect('/admin/forgot-password');
    }
});

// --- 4. RESET PASSWORD (STEP 2: NEW PASSWORD) ---

router.get('/reset-password', (req, res) => {
    // Prevent direct access without verification
    if (!req.session.canResetAdminPassword) {
        req.flash('error', 'Access denied. Please verify your admin code first.');
        return res.redirect('/admin/forgot-password');
    }
    res.render('admin-reset-password', { messages: req.flash(), session: req.session });
});

router.post('/reset-password', async (req, res) => {
    try {
        const { password } = req.body; 
        const username = req.session.resetAdminUsername;

        if (!req.session.canResetAdminPassword || !username) {
            req.flash('error', 'Session expired. Please verify again.');
            return res.redirect('/admin/forgot-password');
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await Admin.findOneAndUpdate({ username }, { password: hashedPassword });

        // Clear reset session flags
        req.session.canResetAdminPassword = false;
        req.session.resetAdminUsername = null;

        req.flash('success', 'Admin password updated successfully!');
        res.redirect('/admin/login');
    } catch (err) {
        req.flash('error', 'Failed to update password');
        res.redirect('/admin/reset-password');
    }
});

// --- 5. DASHBOARD CORE ---

router.get('/dashboard', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const userMessages = await Contact.find().sort({ createdAt: -1 }).lean() || [];
        const animes = await Anime.find()
            .populate('genres')
            .populate({
                path: 'seasons.episodes',
                model: 'Episode'
            })
            .lean(); 
        
        res.render('admin-dashboard', { 
            animes: animes || [], 
            userMessages: userMessages, 
            session: req.session,
            messages: req.flash() 
        });
    } catch (err) {
        console.error("Dashboard Load Error:", err);
        res.status(500).send("Dashboard Error");
    }
});

// --- 6. REPORT MANAGEMENT ---

router.post('/delete-message/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        await Contact.findByIdAndDelete(req.params.id);
        req.flash('success', 'Report archived.');
        res.redirect('/admin/dashboard');
    } catch (err) {
        req.flash('error', 'Failed to delete report.');
        res.redirect('/admin/dashboard');
    }
});

// --- 7. ANIME MANAGEMENT ---

router.get('/add-anime', ensureAuthenticatedAdmin, async (req, res) => {
    const genres = await Genre.find().lean();
    res.render('admin-add-anime', { genres, session: req.session });
});

router.post('/add-anime', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { name, imageUrl, description, genres } = req.body;
        const anime = new Anime({
            name,
            imageUrl,
            description,
            genres: Array.isArray(genres) ? genres : (genres ? [genres] : [])
        });
        await anime.save();
        res.redirect('/admin/dashboard');
    } catch (err) {
        req.flash('error', 'Error adding anime');
        res.redirect('/admin/add-anime');
    }
});

router.get('/edit-anime/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const anime = await Anime.findById(req.params.id).populate('genres').lean();
        const genres = await Genre.find().lean();
        if (!anime) {
            req.flash('error', 'Anime not found');
            return res.redirect('/admin/dashboard');
        }
        res.render('admin-edit-anime', { 
            anime, 
            genres, 
            session: req.session, 
            messages: req.flash() 
        });
    } catch (err) {
        res.redirect('/admin/dashboard');
    }
});

router.post('/edit-anime/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { name, imageUrl, description, genres } = req.body;
        await Anime.findByIdAndUpdate(req.params.id, {
            name,
            imageUrl,
            description,
            genres: Array.isArray(genres) ? genres : (genres ? [genres] : [])
        });
        req.flash('success', 'Anime metadata updated!');
        res.redirect('/admin/dashboard');
    } catch (err) {
        req.flash('error', 'Update failed');
        res.redirect(`/admin/edit-anime/${req.params.id}`);
    }
});

router.post('/delete-anime/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        await Anime.findByIdAndDelete(req.params.id);
        res.redirect('/admin/dashboard');
    } catch (err) {
        res.redirect('/admin/dashboard');
    }
});

// --- 8. EPISODE MANAGEMENT ---

router.get('/add-episode/:animeId', ensureAuthenticatedAdmin, async (req, res) => {
    const anime = await Anime.findById(req.params.animeId).lean();
    res.render('admin-add-episode', { anime, session: req.session, messages: req.flash() });
});

router.post('/add-episode/:animeId', ensureAuthenticatedAdmin, async (req, res) => {
    const { seasonNumber, episodeNumber, title, videoUrl, embedCode, imageUrl } = req.body;
    try {
        let finalEmbedCode = embedCode?.trim() || '';
        if (videoUrl && !finalEmbedCode) {
            finalEmbedCode = `<iframe src="${videoUrl.trim()}" style="border:0;height:360px;width:640px;max-width:100%" allowFullScreen="true" scrolling="no" frameborder="0"></iframe>`;
        }
        const episode = new Episode({
            title: title.trim(),
            videoUrl: videoUrl?.trim() || '',
            embedCode: finalEmbedCode,
            imageUrl: imageUrl?.trim() || '',
            episodeNumber: Number(episodeNumber),
            seasonNumber: Number(seasonNumber)
        });
        await episode.save();

        const anime = await Anime.findById(req.params.animeId);
        let season = anime.seasons.find(s => s.seasonNumber === Number(seasonNumber));
        if (season) {
            season.episodes.push(episode._id);
        } else {
            anime.seasons.push({ seasonNumber: Number(seasonNumber), episodes: [episode._id] });
        }
        await anime.save();
        res.redirect('/admin/dashboard');
    } catch (error) {
        res.redirect(`/admin/add-episode/${req.params.animeId}`);
    }
});

router.post('/delete-episode/:animeId/:seasonId/:episodeId', ensureAuthenticatedAdmin, async (req, res) => {
    const { animeId, seasonId, episodeId } = req.params;
    try {
        const anime = await Anime.findById(animeId);
        const season = anime.seasons.id(seasonId);
        if (season) {
            season.episodes = season.episodes.filter(ep => ep.toString() !== episodeId);
            await anime.save();
        }
        res.redirect('/admin/dashboard');
    } catch (err) {
        res.redirect('/admin/dashboard');
    }
});

// --- 9. GENRE MANAGEMENT ---

router.get('/manage-categories', ensureAuthenticatedAdmin, async (req, res) => {
    const genres = await Genre.find().lean();
    res.render('admin-manage-categories', { genres, session: req.session });
});

router.post('/add-genre', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        await Genre.create({ name: req.body.name.trim() });
        res.redirect('/admin/manage-categories');
    } catch (err) {
        res.redirect('/admin/manage-categories');
    }
});

// --- DELETE GENRE ---
router.post('/delete-genre/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const genreId = req.params.id;

        // 1. Remove the genre from the database
        await Genre.findByIdAndDelete(genreId);

        // 2. (Optional but Recommended) Remove this genre ID from all Anime documents
        // This prevents "dead" IDs from staying in your anime genre arrays
        await Anime.updateMany(
            { genres: genreId }, 
            { $pull: { genres: genreId } }
        );

        req.flash('success', 'Category removed successfully.');
        res.redirect('/admin/manage-categories');
    } catch (err) {
        console.error("Delete Genre Error:", err);
        req.flash('error', 'Failed to delete category.');
        res.redirect('/admin/manage-categories');
    }
});

// --- EDIT GENRE (Update) ---
router.post('/edit-genre/:id', ensureAuthenticatedAdmin, async (req, res) => {
    try {
        const { name } = req.body;
        await Genre.findByIdAndUpdate(req.params.id, { name: name.trim() });
        
        req.flash('success', 'Category updated.');
        res.redirect('/admin/manage-categories');
    } catch (err) {
        req.flash('error', 'Update failed.');
        res.redirect('/admin/manage-categories');
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/admin/login'));
});

module.exports = router;