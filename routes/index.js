const express = require('express');
const router = express.Router();
const Anime = require('../models/Anime');
const Genre = require('../models/Genre');
const Episode = require('../models/Episode');
const { ensureAuthenticatedUser } = require('../middleware/auth');

const axios = require('axios');
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 1800 }); // 30 min cache

/**
 * GET /
 * Home Route - Optimized for Premium 2026 performance.
 * Displays Anime Catalog, Category Filters, and the Latest Releases feed.
 * UPDATED: Supports 3 sections - Latest, Normal, Movies
 */

router.get('/', ensureAuthenticatedUser, async (req, res) => {
    const searchQuery = req.query.q || '';
    const selectedGenre = req.query.genre || '';

    const renderData = {
        searchQuery,
        selectedGenre,
        isSearchResult:!!(searchQuery || selectedGenre),
        animes: [],
        genres: [],
        latestGenres: [], // NEW: Latest wale genres
        normalGenres: [], // NEW: Normal genres
        movieGenres: [], // NEW: Movie wale genres
        latestEpisodes: []
    };

    try {
        // ============================================
        // 1. GENRE AGGREGATION - 3 SECTION LOGIC
        // ============================================
        // isLatest: "latest" keyword wale top pe
        // isMovie: "movie" keyword wale sabse neeche
        // sortSeq: sequence field se sort, null = 9999
        // ============================================
        const genres = await Genre.aggregate([
            {
                $addFields: {
                    isLatest: {
                        $cond: {
                            if: { $regexMatch: { input: "$name", regex: /latest/i } },
                            then: 0, // Latest = priority 0, top pe
                            else: 1 // Normal = priority 1
                        }
                    },
                    isMovie: {
                        $cond: {
                            if: { $regexMatch: { input: "$name", regex: /movie/i } },
                            then: 1, // Movie = priority 1, neeche
                            else: 0 // Normal/Latest = priority 0
                        }
                    },
                    sortSeq: { $ifNull: ["$sequence", 9999] }
                }
            },
            {
                $sort: {
                    isMovie: 1, // Movies sabse neeche: 0 pehle, 1 baad mein
                    isLatest: 1, // Latest top pe: 0 pehle, 1 baad mein
                    sortSeq: 1, // Sequence: 1,2,3...9999
                    name: 1 // Same sequence wale A-Z
                }
            }
        ]);

        // ============================================
        // 2. GENRES KO 3 SECTION MEIN BAATO
        // ============================================
        // latestGenres: Jisme "latest" word hai
        // movieGenres: Jisme "movie" word hai but "latest" nahi
        // normalGenres: Baaki sab
        // ============================================
        const latestGenres = genres.filter(g => /latest/i.test(g.name));
        const movieGenres = genres.filter(g => /movie/i.test(g.name) &&!/latest/i.test(g.name));
        const normalGenres = genres.filter(g =>!/latest/i.test(g.name) &&!/movie/i.test(g.name));

        // 3. Exact Match Shortcut
        if (searchQuery) {
            const exactMatch = await Anime.findOne({
                name: new RegExp(`^${searchQuery.trim()}$`, 'i')
            }).lean();

            if (exactMatch) {
                return res.redirect(`/anime/${exactMatch._id}`);
            }
        }

        // 4. Build Dynamic Query
        const animeQuery = {};
        if (searchQuery) {
            animeQuery.name = { $regex: searchQuery.trim(), $options: 'i' };
        }
        if (selectedGenre) {
            animeQuery.genres = selectedGenre;
        }

        // 5. Database Fetch
        const animes = await Anime.find(animeQuery)
       .populate('genres')
       .sort({ createdAt: -1 })
       .lean();

        // 6. Latest Episodes
        const latestEpisodesData = await Episode.find({ anime: { $exists: true, $ne: null } })
       .sort({ createdAt: -1 })
       .limit(20)
       .lean();

        const animeIds = [...new Set(
            latestEpisodesData
            .filter(ep => ep.anime)
            .map(ep => ep.anime.toString())
        )];

        // FIX: 'type' add kiya select mein
        const animeMap = await Anime.find({ _id: { $in: animeIds } })
       .select('name imageUrl type')
       .lean();

        const animeLookup = {};
        animeMap.forEach(a => animeLookup[a._id.toString()] = a);

        const latestEpisodes = latestEpisodesData
       .filter(ep => ep.anime && animeLookup[ep.anime.toString()])
       .map(ep => ({
           ...ep,
                anime: animeLookup[ep.anime.toString()]
            }));

        // 7. Dynamic Genre Sorting - Selected genre top pe
        // NOTE: Ye sirf normalGenres pe apply hoga agar search hai
        let sortedGenres = [...genres];
        if (selectedGenre) {
            const index = sortedGenres.findIndex(g => g._id.toString() === selectedGenre);
            if (index!== -1) {
                const [selected] = sortedGenres.splice(index, 1);
                sortedGenres.unshift(selected);
            }
        }

        // 8. Final Page Render
        res.render('index', {
       ...renderData,
            animes,
            genres: sortedGenres, // Purana code ke liye, backward compatible
            latestGenres, // NEW: Latest section ke liye
            normalGenres, // NEW: Normal genres ke liye
            movieGenres, // NEW: Movies section ke liye
            latestEpisodes
        });

    } catch (err) {
        console.error('Core Index Error:', err);
        req.flash('error', 'System was unable to synchronize the catalog.');
        res.render('index', renderData);
    }
});

/**
 * GET /search
 * Form Redirector - Ensures clean URLs and history stack.
 */
router.get('/search', ensureAuthenticatedUser, (req, res) => {
    const { q = '', genre = '' } = req.query;
    const params = new URLSearchParams();
    if (q) params.append('q', q);
    if (genre) params.append('genre', genre);

    res.redirect(`/?${params.toString()}`);
});

// AniList IST Schedule - Grouped by Day - PUBLIC ROUTE
router.get('/api/upcoming-schedule', async (req, res) => {
    try {
        const cached = cache.get('anilistScheduleIST');
        if (cached) return res.json(cached);

        const query = `
        query {
            Page(page: 1, perPage: 50) {
                media(status: RELEASING, type: ANIME, sort: POPULARITY_DESC) {
                    id
                    title {
                        romaji
                        english
                    }
                    coverImage {
                        large
                    }
                    nextAiringEpisode {
                        airingAt
                        episode
                    }
                }
            }
        }`;

        const { data } = await axios.post('https://graphql.anilist.co',
            { query },
            {
                headers: { 'Content-Type': 'application/json' },
                timeout: 8000
            }
        );

        if (!data?.data?.Page?.media) {
            throw new Error('Invalid AniList response');
        }

        const scheduleByDay = {
            Monday: [], Tuesday: [], Wednesday: [], Thursday: [],
            Friday: [], Saturday: [], Sunday: []
        };

        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        data.data.Page.media
        .filter(anime => anime.nextAiringEpisode)
        .forEach(anime => {
                const utcDate = new Date(anime.nextAiringEpisode.airingAt * 1000);
                const istDate = new Date(utcDate.getTime() + (5.5 * 60 * 60 * 1000));

                const dayName = dayNames[istDate.getUTCDay()];
                const hours = istDate.getUTCHours();
                const minutes = istDate.getUTCMinutes();

                const period = hours >= 12? 'pm' : 'am';
                const displayHours = hours % 12 || 12;
                const displayMins = minutes.toString().padStart(2, '0');
                const timeStr = `${displayHours}:${displayMins} ${period}`;

                scheduleByDay[dayName].push({
                    id: anime.id,
                    title: anime.title.english || anime.title.romaji,
                    image: anime.coverImage.large,
                    episode: anime.nextAiringEpisode.episode,
                    time: timeStr,
                    timestamp: istDate.getTime()
                });
            });

        // Sort each day by time
        Object.keys(scheduleByDay).forEach(day => {
            scheduleByDay[day].sort((a, b) => a.timestamp - b.timestamp);
        });

        cache.set('anilistScheduleIST', scheduleByDay);
        res.json(scheduleByDay);
    } catch (err) {
        console.error('AniList API error:', err.message);
        res.json({
            Monday: [], Tuesday: [], Wednesday: [], Thursday: [],
            Friday: [], Saturday: [], Sunday: []
        });
    }
});

module.exports = router;