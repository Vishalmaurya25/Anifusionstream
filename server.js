require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const flash = require('connect-flash');
const path = require('path');
const MongoDBStore = require('connect-mongodb-session')(session);
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// ==========================================
// 1. PROXY TRUST (CRITICAL FOR LIVE DOMAINS)
// ==========================================
app.set('trust proxy', 1);

// ==========================================
// 2. SECURITY MIDDLEWARE
// ==========================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:", "http:"],
            frameSrc: ["'self'", "https:"],
            connectSrc: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));

// ==========================================
// GLOBAL RATE LIMITER - FIXED
// ==========================================
// PROBLEM: Pehle 100 requests/15min tha, jo bohot kam hai
// SOLUTION: 500 requests/15min kar diya + static files ko skip kiya
// ==========================================
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // CHANGED: 100 se 500 kar diya, normal browsing ke liye sufficient
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Static files ko count mat karo: CSS, JS, images, fonts
        return req.path.startsWith('/public') || 
               req.path.endsWith('.css') || 
               req.path.endsWith('.js') || 
               req.path.endsWith('.png') || 
               req.path.endsWith('.jpg') || 
               req.path.endsWith('.ico');
    }
});
app.use(globalLimiter);

// ==========================================
// 3. SESSION STORE SETUP
// ==========================================
const store = new MongoDBStore({
    uri: process.env.MONGO_URI,
    collection: 'sessions',
    expires: 1000 * 60 * 60 * 24 * 7, // 1 week
    connectionOptions: {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000
    }
});

store.on('error', function(error) {
    console.error('Session Store Error:', error.message);
    console.error('Check MongoDB Atlas IP Whitelist & Internet Connection');
});

// ==========================================
// 4. VIEW ENGINE & STATIC FILES
// ==========================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 5. MIDDLEWARE (ORDER IS CRITICAL)
// ==========================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// A. Session Middleware (Must be before Flash)
app.use(session({
    secret: process.env.SESSION_SECRET || 'anifusion_secret_key_2026',
    resave: false,
    saveUninitialized: false,
    store: store,
    name: 'anifusion.sid',
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));

// B. Flash Middleware (Must be after Session)
app.use(flash());

// ==========================================
// 6. GLOBAL VIEW CONTEXT (Automated UI Logic)
// ==========================================
app.use((req, res, next) => {
    res.locals.session = req.session;
    res.locals.messages = req.flash();
    res.locals.isAdmin = !!req.session.isAdminAuthenticated;
    res.locals.isUser = !!req.session.isUserAuthenticated;
    res.locals.adminUsername = req.session.adminUsername || null;
    res.locals.username = req.session.username || null;
    next();
});

// ==========================================
// 7. ROUTES
// ==========================================
app.use('/', require('./routes/index'));
app.use('/admin', require('./routes/admin'));
app.use('/user', require('./routes/user'));
app.use('/anime', require('./routes/anime'));
app.use('/', require('./routes/pages'));

// ==========================================
// 8. 404 ERROR HANDLER
// ==========================================
app.use((req, res) => {
    res.status(404).render('404', { title: '404 - Signal Lost' });
});

// ==========================================
// 9. 500 ERROR HANDLER
// ==========================================
app.use((err, req, res, next) => {
    console.error('Server Error:', err.stack);
    res.status(500).render('404', {
        title: '500 - Server Error',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// ==========================================
// 10. DATABASE CONNECTION
// ==========================================
mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
})
    .then(() => {
        console.log('✅ MongoDB Connected');
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`🌍 Mode: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔑 Admin Code Active: ${process.env.ADMIN_CODE ? 'YES' : 'NO'}`);
        });
    })
    .catch(err => {
        console.error('❌ Critical MongoDB Connection Error:', err.message);
        console.error('Check: 1) MONGO_URI in .env  2) Atlas IP Whitelist  3) Internet Connection');
        process.exit(1);
    });

process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM received, shutting down...');
    await mongoose.connection.close();
    process.exit(0);
});