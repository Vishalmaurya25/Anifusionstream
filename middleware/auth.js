const Admin = require('../models/Admin');
const User = require('../models/User');

/**
 * Cache for verified sessions to reduce DB hits
 * Key: sessionId, Value: { userId, isAdmin, verifiedAt }
 * TTL: Reduced to 15 seconds. This balances ultra-fast performance 
 * while ensuring a deleted user is kicked out almost instantly.
 */
const sessionCache = new Map();
const CACHE_TTL = 15 * 1000; // 15 seconds

const isCacheValid = (cacheEntry) => {
    return cacheEntry && (Date.now() - cacheEntry.verifiedAt < CACHE_TTL);
};

const clearSessionAndRedirect = (req, res, redirectPath) => {
    if (req.session) {
        const sessionId = req.session.id;
        sessionCache.delete(sessionId);
        return req.session.destroy(() => {
            res.clearCookie('connect.sid', { path: '/' });
            res.redirect(redirectPath);
        });
    }
    res.redirect(redirectPath);
};

/**
 * Ensures the person is either a valid User OR a valid Admin.
 */
const ensureAuthenticatedUser = async (req, res, next) => {
    try {
        const sessionId = req.session?.id;
        
        // 1. Check cache first
        if (sessionId && sessionCache.has(sessionId)) {
            const cached = sessionCache.get(sessionId);
            if (isCacheValid(cached)) {
                return next();
            }
            sessionCache.delete(sessionId);
        }

        // 2. Check Admin Session
        if (req.session?.isAdminAuthenticated && req.session.adminId) {
            const adminExists = await Admin.findById(req.session.adminId).select('_id').lean();
            if (adminExists) {
                if (sessionId) {
                    sessionCache.set(sessionId, {
                        userId: req.session.adminId,
                        isAdmin: true,
                        verifiedAt: Date.now()
                    });
                }
                return next();
            } else {
                // Admin deleted from DB, destroy session
                return clearSessionAndRedirect(req, res, '/admin/login');
            }
        }

        // 3. Check User Session
        if (req.session?.isUserAuthenticated && req.session.userId) {
            const userExists = await User.findById(req.session.userId).select('_id').lean();
            if (userExists) {
                if (sessionId) {
                    sessionCache.set(sessionId, {
                        userId: req.session.userId,
                        isAdmin: false,
                        verifiedAt: Date.now()
                    });
                }
                return next();
            } else {
                
                // THE FIX: User was deleted by admin!
                // Aggressively destroy the session and kick them out.
                
                console.log(`[Security] Deleted user detected. Destroying session.`);
                return clearSessionAndRedirect(req, res, '/user/login');
            }
        }

        // 4. No valid session found
        req.flash('error', 'Session expired. Please login again.');
        return res.redirect('/user/login');

    } catch (err) {
        console.error("Auth Middleware Error:", err);
        res.status(500).send("Internal Security Error");
    }
};

/**
 * Strict Admin-only middleware.
 */
const ensureAuthenticatedAdmin = async (req, res, next) => {
    try {
        const sessionId = req.session?.id;

        // 1. Check cache first
        if (sessionId && sessionCache.has(sessionId)) {
            const cached = sessionCache.get(sessionId);
            if (isCacheValid(cached) && cached.isAdmin) {
                return next();
            }
            sessionCache.delete(sessionId);
        }

        // 2. Check Admin Session
        if (req.session?.isAdminAuthenticated && req.session.adminId) {
            const adminExists = await Admin.findById(req.session.adminId).select('_id').lean();
            
            if (adminExists) {
                if (sessionId) {
                    sessionCache.set(sessionId, {
                        userId: req.session.adminId,
                        isAdmin: true,
                        verifiedAt: Date.now()
                    });
                }
                return next();
            } else {
                // Admin was deleted from DB
                return clearSessionAndRedirect(req, res, '/admin/login');
            }
        }

        // 3. Fail: Admin session not found
        req.flash('error', 'Admin access required. Please login.');
        return res.redirect('/admin/login');

    } catch (err) {
        console.error("Admin Auth Error:", err);
        res.status(500).send("Security System Error");
    }
};

// Clear cache on logout - call this in logout routes
const clearSessionCache = (sessionId) => {
    if (sessionId) sessionCache.delete(sessionId);
};

module.exports = { 
    ensureAuthenticatedUser, 
    ensureAuthenticatedAdmin,
    clearSessionCache 
};