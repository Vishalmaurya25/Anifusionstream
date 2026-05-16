const express = require('express');
const router = express.Router();
const Anime = require('../models/Anime');
const Genre = require('../models/Genre');
const Episode = require('../models/Episode');
const { ensureAuthenticatedUser } = require('../middleware/auth');
const axios = require('axios');
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 1800 }); 

function escapeRegex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/**
 * GET /
 * Optimized Hybrid Homepage & Paginated Search
 */
router.get('/', ensureAuthenticatedUser, async (req, res) => {
    const searchQuery = req.query.q ? escapeRegex(req.query.q.trim()) : '';
    const selectedGenre = req.query.genre || '';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20; 

    const renderData = {
        searchQuery: req.query.q || '',
        selectedGenre,
        isSearchResult: !!(searchQuery || selectedGenre),
        currentPage: page,
        totalPages: 0,
        totalResults: 0,
        animes: [],
        genres: [],
        latestGenres: [],
        normalGenres: [],
        movieGenres: [],
        latestEpisodes: []
    };

    try {
        const genres = await Genre.aggregate([
            {
                $addFields: {
                    isLatest: { $cond: { if: { $regexMatch: { input: "$name", regex: /latest/i } }, then: 0, else: 1 } },
                    isMovie: { $cond: { if: { $regexMatch: { input: "$name", regex: /movie/i } }, then: 1, else: 0 } },
                    sortSeq: { $ifNull: ["$sequence", 9999] }
                }
            },
            { $sort: { isMovie: 1, isLatest: 1, sortSeq: 1, name: 1 } }
        ]);

        let sortedGenres = [...genres];
        if (selectedGenre) {
            const index = sortedGenres.findIndex(g => g._id.toString() === selectedGenre);
            if (index !== -1) {
                const [selected] = sortedGenres.splice(index, 1);
                sortedGenres.unshift(selected);
            }
        }
        renderData.genres = sortedGenres;

        // SEARCH OR GENRE FILTER PAGE (Paginated)
        if (renderData.isSearchResult) {
            if (searchQuery) {
                const exactMatch = await Anime.findOne({ name: new RegExp(`^${searchQuery}$`, 'i') }).lean();
                if (exactMatch) return res.redirect(`/anime/${exactMatch._id}`);
            }

            const animeQuery = {};
            if (searchQuery) animeQuery.name = { $regex: searchQuery, $options: 'i' };
            if (selectedGenre) animeQuery.genres = selectedGenre;

            const [animes, totalAnimes] = await Promise.all([
                Anime.find(animeQuery)
                    .select('name imageUrl updatedAt type')
                    // STRICT SORTING FIX
                    .sort({ updatedAt: -1, _id: -1 }) 
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .lean(),
                Anime.countDocuments(animeQuery)
            ]);

            renderData.animes = animes;
            renderData.totalResults = totalAnimes;
            renderData.totalPages = Math.ceil(totalAnimes / limit);
        } 
        // STANDARD HOMEPAGE (Lazy Seeded - ONLY fetches 6 per genre initially)
        else {
            let latestGenres = genres.filter(g => /latest/i.test(g.name));
            let movieGenres = genres.filter(g => /movie/i.test(g.name) && !/latest/i.test(g.name));
            let normalGenres = genres.filter(g => !/latest/i.test(g.name) && !/movie/i.test(g.name));

            const fetchInitialAnimes = (genreId) => {
                return Anime.find({ genres: genreId })
                    .select('name imageUrl updatedAt type')
                    // STRICT SORTING FIX: Must match lazy-loader exactly
                    .sort({ updatedAt: -1, _id: -1 })
                    .limit(6)
                    .lean();
            };

            const allGroups = [...latestGenres, ...normalGenres, ...movieGenres];
            await Promise.all(allGroups.map(async (g) => {
                g.initialAnimes = await fetchInitialAnimes(g._id);
            }));

            renderData.latestGenres = latestGenres.filter(g => g.initialAnimes.length > 0);
            renderData.normalGenres = normalGenres.filter(g => g.initialAnimes.length > 0);
            renderData.movieGenres = movieGenres.filter(g => g.initialAnimes.length > 0);

            const latestEpisodesData = await Episode.find({ anime: { $exists: true, $ne: null } })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean();

            const animeIds = [...new Set(latestEpisodesData.map(ep => ep.anime.toString()))];
            const animeMap = await Anime.find({ _id: { $in: animeIds } }).select('name imageUrl type').lean();
            const animeLookup = Object.fromEntries(animeMap.map(a => [a._id.toString(), a]));

            renderData.latestEpisodes = latestEpisodesData
                .filter(ep => animeLookup[ep.anime.toString()])
                .map(ep => ({ ...ep, anime: animeLookup[ep.anime.toString()] }));
        }

        res.render('index', renderData);
    } catch (err) {
        console.error('Core Index Error:', err);
        req.flash('error', 'System was unable to synchronize the catalog.');
        res.render('index', renderData);
    }
});

router.get('/search', ensureAuthenticatedUser, (req, res) => {
    const { q = '', genre = '' } = req.query;
    const params = new URLSearchParams();
    if (q) params.append('q', q);
    if (genre) params.append('genre', genre);
    res.redirect(`/?${params.toString()}`);
});

// Debounced backend search for dropdown UI
router.get('/api/search-suggestions', ensureAuthenticatedUser, async (req, res) => {
    try {
        const q = req.query.q ? escapeRegex(req.query.q.trim()) : '';
        if (!q || q.length < 2) return res.json([]);

        const animes = await Anime.find({ name: { $regex: q, $options: 'i' } })
            .select('name _id')
            .limit(6)
            .lean();
            
        res.json(animes);
    } catch (err) {
        console.error('Search API Error:', err);
        res.status(500).json([]);
    }
});

// Infinite Horizontal Scroll Batch Loader
router.get('/api/genre/:id/load', ensureAuthenticatedUser, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 8;
        
        // We receive EXACTLY how many cards to skip from the frontend tracker
        const skip = parseInt(req.query.skip) || 6; 
        
        const genreId = req.params.id;

        const mongoose = require('mongoose');
        if (!genreId || genreId === 'undefined' || !mongoose.Types.ObjectId.isValid(genreId)) {
            return res.json([]); 
        }

        const animes = await Anime.find({ genres: genreId })
            .select('name imageUrl updatedAt type')
            // STRICT SORTING FIX: Identical to SSR
            .sort({ updatedAt: -1, _id: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        res.json(animes);
    } catch (err) {
        console.error('Lazy Load Error:', err);
        res.status(500).json([]);
    }
});

// AniList IST Schedule
router.get('/api/upcoming-schedule', async (req, res) => {
    try {
        const cached = cache.get('anilistScheduleIST');
        if (cached) return res.json(cached);

        const query = `
        query {
            Page(page: 1, perPage: 50) {
                media(status: RELEASING, type: ANIME, sort: POPULARITY_DESC) {
                    id title { romaji english } coverImage { large } nextAiringEpisode { airingAt episode }
                }
            }
        }`;

        const { data } = await axios.post('https://graphql.anilist.co', { query }, {
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'AniFusionStream/1.0' },
            timeout: 15000
        });

        if (!data || !data.data || !data.data.Page || !data.data.Page.media) throw new Error('Invalid response');

        const scheduleByDay = { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] };
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        data.data.Page.media.filter(a => a.nextAiringEpisode).forEach(anime => {
            const utcDate = new Date(anime.nextAiringEpisode.airingAt * 1000);
            const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));
            const dayName = dayNames[istDate.getUTCDay()];
            const hours = istDate.getUTCHours();
            const minutes = istDate.getUTCMinutes();
            const period = hours >= 12 ? 'pm' : 'am';
            const displayHours = hours % 12 || 12;
            const timeStr = `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;

            scheduleByDay[dayName].push({
                id: anime.id, title: anime.title.english || anime.title.romaji,
                image: anime.coverImage.large, episode: anime.nextAiringEpisode.episode,
                time: timeStr, timestamp: istDate.getTime()
            });
        });

        Object.keys(scheduleByDay).forEach(day => scheduleByDay[day].sort((a, b) => a.timestamp - b.timestamp));
        cache.set('anilistScheduleIST', scheduleByDay);
        res.json(scheduleByDay);
    } catch (err) {
        console.error('AniList API error:', err.message);
        cache.del('anilistScheduleIST');
        res.json({ Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] });
    }
});

module.exports = router;