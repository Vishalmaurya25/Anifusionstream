const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html'); 
const { clearSessionCache } = require('../middleware/auth');

// Models
const User = require('../models/User');
const OTP = require('../models/OTP');


// 1. EMAIL CONFIGURATION

const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});


// 2. RATE LIMITERS

const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 3, 
    message: 'Too many OTP requests. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, 
    message: 'Too many login attempts. Please try again later.',
});


// 3. HELPER FUNCTIONS

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email) && email.length <= 254;
};

const validateUsername = (username) => {
    return username.length >= 3 && username.length <= 20 && /^[a-zA-Z0-9_]+$/.test(username);
};

const validatePassword = (password) => {
    return password.length >= 8 && password.length <= 128;
};

const sanitizeInput = (text) => sanitizeHtml(text.trim(), {
    allowedTags: [],
    allowedAttributes: {}
});

const sendOTPEmail = async (email, username, otp, type = 'registration') => {
    const isReset = type === 'reset';
    const subject = isReset ? 'Reset Your Password' : 'Verify Your Email';
    const heading = isReset ? 'Password Reset Request' : 'Email Verification';
    const actionText = isReset ? 'reset your password' : 'complete your registration';
    const iconColor = isReset ? '#f59e0b' : '#3b82f6';
    const iconBg = isReset ? 'rgba(245, 158, 11, 0.1)' : 'rgba(59, 130, 246, 0.1)';
    const icon = isReset ? '🔐' : '✉️';

    return transporter.sendMail({
        from: `"AniFusion" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `AniFusion: ${subject}`,
        html: `
<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #06090e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 20px;">
                <tr>
                    <td align="center">
                        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: #0f141e; border-radius: 16px; border: 1px solid rgba(59,130,246,0.2); overflow: hidden;">
                            
                            <!-- Header Section -->
                            <tr>
                                <td style="background: linear-gradient(135deg, ${isReset ? '#facc15 0%, #06b6d4' : '#3b82f6 0%, #06b6d4'} 100%); padding: 40px 30px; text-align: center;">
                                    <div style="width: 60px; height: 60px; background-color: rgba(0,0,0,0.2); border-radius: 16px; display: inline-block; line-height: 60px; margin-bottom: 16px;">
                                        <span style="font-size: 32px;">${icon}</span>
                                    </div>
                                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 900; text-transform: uppercase;">
                                        AniFusion System
                                    </h1>
                                    <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px;">
                                        // ${heading}
                                    </p>
                                </td>
                            </tr>
                            
                            <!-- Content Section -->
                            <tr>
                                <td style="padding: 40px 30px;">
                                    <h2 style="margin: 0 0 16px 0; color: #e2e8f0; font-size: 22px; font-weight: 800;">
                                        User Alias: ${sanitizeHtml(username)}
                                    </h2>
                                    <p style="margin: 0 0 24px 0; color: #94a3b8; font-size: 15px; line-height: 1.6;">
                                        Input the secure code below to ${actionText}. This access code self-destructs in 5 minutes.
                                    </p>
                                    
                                    <!-- OTP Box -->
                                    <div style="background: rgba(0,0,0,0.5); border: 1px solid ${iconColor}; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                                        <p style="margin: 0 0 8px 0; color: #94a3b8; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px;">
                                            Authorization Code
                                        </p>
                                        <h1 style="margin: 0; color: #ffffff; font-size: 42px; font-weight: 900; letter-spacing: 8px; font-family: 'Courier New', monospace; text-shadow: 0 0 15px ${iconColor};">
                                            ${otp}
                                        </h1>
                                    </div>
                                    
                                    <p style="margin: 24px 0 0 0; color: #64748b; font-size: 13px; line-height: 1.6;">
                                        If you did not initiate this protocol, ignore this transmission.
                                    </p>
                                </td>
                            </tr>
                            
                            <!-- Footer Section -->
                            <tr>
                                <td style="background-color: #06090e; padding: 24px 30px; text-align: center; border-top: 1px solid rgba(255,255,255,0.05);">
                                    <p style="margin: 0 0 8px 0; color: #64748b; font-size: 13px; font-weight: 600;">
                                        Need technical support? Contact <a href="mailto:anifusionstream@gmail.com" style="color: #3b82f6; text-decoration: none;">anifusionstream@gmail.com</a>
                                    </p>
                                    <p style="margin: 0; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                                        © 2026 AniFusion. All rights reserved.
                                    </p>
                                </td>
                            </tr>
                            
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
        `
    });
};


// 4. REGISTRATION & VERIFICATION


router.get('/register', (req, res) => res.render('user-register'));

router.post('/register', otpLimiter, async (req, res) => {
    try {
        let { email, password, username } = req.body;
        email = email.toLowerCase().trim();
        username = sanitizeInput(username);

        // Validation
        if (!validateEmail(email)) {
            req.flash('error', 'Invalid email format.');
            return res.redirect('/user/register');
        }
        if (!validateUsername(username)) {
            req.flash('error', 'Username must be 3-20 characters, alphanumeric only.');
            return res.redirect('/user/register');
        }
        if (!validatePassword(password)) {
            req.flash('error', 'Password must be 8-128 characters.');
            return res.redirect('/user/register');
        }

        // Check duplicates
        if (await User.findOne({ email })) {
            req.flash('error', 'Email already registered.');
            return res.redirect('/user/register');
        }
        if (await User.findOne({ username })) {
            req.flash('error', 'Username already exists.');
            return res.redirect('/user/register');
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const otp = generateOTP();

        // FIX: Match the Schema. Use 'type', rely on MongoDB TTL for expiration
        await OTP.deleteMany({ email });
        await OTP.create({ 
            email, 
            otp, 
            type: 'registration' 
        });

        await sendOTPEmail(email, username, otp, 'registration');

        req.session.tempUser = { email, password: hashedPassword, username };

        req.session.save(() => {
            req.flash('info', 'Verification code sent to your email.');
            res.redirect('/user/register-verify-otp');
        });
    } catch (err) {
        console.error('Register error:', err);
        req.flash('error', 'Registration service error.');
        res.redirect('/user/register');
    }
});

router.get('/register-verify-otp', (req, res) => {
    if (!req.session.tempUser) return res.redirect('/user/register');
    res.render('user-register-verify-otp');
});

// FIX: Bulletproof Verification leveraging your TTL Schema
router.post('/register-verify-otp', async (req, res) => {
    try {
        let { otp } = req.body;
        otp = otp.trim();

        const tempUser = req.session.tempUser;
        if (!tempUser) return res.redirect('/user/register');

        // findOneAndDelete will securely check the OTP and delete it in one move.
        // If it's not found, it means the OTP is wrong OR MongoDB automatically deleted it after 5 mins!
        const record = await OTP.findOneAndDelete({
            email: tempUser.email,
            otp: otp,
            type: 'registration'
        });

        if (!record) {
            req.flash('error', 'Invalid or expired code.');
            return res.redirect('/user/register-verify-otp');
        }

        // OTP is correct! Create user.
        try {
            const user = await User.create(tempUser);
            delete req.session.tempUser;

            // Regenerate session
            req.session.regenerate((err) => {
                if (err) throw err;
                req.session.isUserAuthenticated = true;
                req.session.userId = user._id.toString();
                req.session.username = user.username;
                req.session.save(() => {
                    req.flash('success', 'Account verified! Welcome to the system.');
                    res.redirect('/');
                });
            });
        } catch (err) {
            if (err.code === 11000) {
                delete req.session.tempUser;
                req.flash('error', `Details already taken. Please register again.`);
                return res.redirect('/user/register');
            }
            throw err;
        }
    } catch (err) {
        console.error('Verify OTP error:', err);
        req.flash('error', 'Verification failed.');
        res.redirect('/user/register-verify-otp');
    }
});

router.post('/resend-register-otp', otpLimiter, async (req, res) => {
    try {
        const tempUser = req.session.tempUser;
        if (!tempUser) {
            req.flash('error', 'Session expired. Please register again.');
            return res.redirect('/user/register');
        }

        const otp = generateOTP();
        await OTP.deleteMany({ email: tempUser.email });
        await OTP.create({ 
            email: tempUser.email, 
            otp, 
            type: 'registration' 
        });

        await sendOTPEmail(tempUser.email, tempUser.username, otp, 'registration');

        req.flash('success', 'New verification code sent to your email.');
        res.redirect('/user/register-verify-otp');
    } catch (err) {
        console.error('Resend register OTP error:', err);
        req.flash('error', 'Failed to resend code. Try again.');
        res.redirect('/user/register-verify-otp');
    }
});

// 5. LOGIN & LOGOUT

router.get('/login', (req, res) => res.render('user-login'));

router.post('/login', loginLimiter, async (req, res) => {
    try {
        let { email, password } = req.body;
        email = email.toLowerCase().trim();

        if (!validateEmail(email) || !password) {
            req.flash('error', 'Invalid email or password.');
            return res.redirect('/user/login');
        }

        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            req.flash('error', 'Invalid email or password.');
            return res.redirect('/user/login');
        }

        req.session.regenerate((err) => {
            if (err) throw err;
            req.session.isUserAuthenticated = true;
            req.session.userId = user._id.toString();
            req.session.username = user.username;
            req.session.save(() => {
                req.flash('success', `Welcome back, ${user.username}!`);
                res.redirect('/');
            });
        });
    } catch (err) {
        console.error('Login error:', err);
        req.flash('error', 'Authentication system error.');
        res.redirect('/user/login');
    }
});

router.post('/logout', (req, res) => {
    const sessionId = req.session?.id;
    if (req.session) {
        req.session.destroy((err) => {
            if (err) console.error("User Session Destroy Error:", err);
            clearSessionCache(sessionId); 
            res.clearCookie('connect.sid', { path: '/' });
            res.redirect('/user/login');
        });
    } else {
        res.clearCookie('connect.sid', { path: '/' });
        res.redirect('/user/login');
    }
});


// 6. PASSWORD RECOVERY


router.get('/forgot-password', (req, res) => res.render('user-forgot-password'));

router.post('/forgot-password', otpLimiter, async (req, res) => {
    try {
        let { email } = req.body;
        email = email.toLowerCase().trim();

        if (!validateEmail(email)) {
            req.flash('error', 'Invalid email format.');
            return res.redirect('/user/forgot-password');
        }

        const user = await User.findOne({ email });

        if (user) {
            const otp = generateOTP();
            await OTP.deleteMany({ email });
            await OTP.create({ 
                email, 
                otp, 
                type: 'reset' 
            });
            await sendOTPEmail(email, user.username, otp, 'reset');
        }

        req.session.resetEmail = email;
        req.session.save(() => {
            req.flash('info', 'If an account exists, a recovery code has been sent.');
            res.redirect('/user/verify-otp');
        });
    } catch (err) {
        console.error('Forgot password error:', err);
        req.flash('error', 'Service error. Try again.');
        res.redirect('/user/forgot-password');
    }
});

router.get('/verify-otp', (req, res) => {
    if (!req.session.resetEmail) return res.redirect('/user/forgot-password');
    res.render('user-verify-otp');
});

// FIX: Reset Password OTP Verification
router.post('/verify-otp', async (req, res) => {
    try {
        let { otp } = req.body;
        otp = otp.trim();
        const email = req.session.resetEmail;

        if (!email) {
            req.flash('error', 'Session expired.');
            return res.redirect('/user/forgot-password');
        }

        const record = await OTP.findOneAndDelete({
            email: email,
            otp: otp,
            type: 'reset'
        });

        if (!record) {
            req.flash('error', 'Invalid or expired code.');
            return res.redirect('/user/verify-otp');
        }

        req.session.otpVerified = true;
        req.session.save(() => res.redirect('/user/reset-password'));
    } catch (err) {
        console.error('Verify OTP error:', err);
        req.flash('error', 'Verification failed.');
        res.redirect('/user/verify-otp');
    }
});

router.post('/resend-reset-otp', otpLimiter, async (req, res) => {
    try {
        const email = req.session.resetEmail;
        if (!email) {
            req.flash('error', 'Session expired. Please try again.');
            return res.redirect('/user/forgot-password');
        }

        const user = await User.findOne({ email });
        if (!user) {
            req.flash('info', 'If an account exists, a recovery code has been sent.');
            return res.redirect('/user/verify-otp');
        }

        const otp = generateOTP();
        await OTP.deleteMany({ email });
        await OTP.create({ 
            email, 
            otp, 
            type: 'reset' 
        });
        
        await sendOTPEmail(email, user.username, otp, 'reset');

        req.flash('success', 'New recovery code sent.');
        res.redirect('/user/verify-otp');
    } catch (err) {
        console.error('Resend reset OTP error:', err);
        req.flash('error', 'Failed to resend code. Try again.');
        res.redirect('/user/verify-otp');
    }
});

router.get('/reset-password', (req, res) => {
    if (!req.session.resetEmail || !req.session.otpVerified) return res.redirect('/user/forgot-password');
    res.render('user-reset-password');
});

router.post('/reset-password', async (req, res) => {
    try {
        const { newPassword, confirmPassword } = req.body;
        const email = req.session.resetEmail;

        if (!req.session.otpVerified || !email) {
            req.flash('error', 'Session expired.');
            return res.redirect('/user/forgot-password');
        }

        if (newPassword !== confirmPassword) {
            req.flash('error', 'Passwords do not match.');
            return res.redirect('/user/reset-password');
        }

        if (!validatePassword(newPassword)) {
            req.flash('error', 'Password must be 8-128 characters.');
            return res.redirect('/user/reset-password');
        }

        const hashedPassword = await bcrypt.hash(newPassword, 12);
        await User.findOneAndUpdate({ email }, { password: hashedPassword });

        delete req.session.resetEmail;
        delete req.session.otpVerified;

        req.session.save(() => {
            req.flash('success', 'Password reset successfully. Please login.');
            res.redirect('/user/login');
        });
    } catch (err) {
        console.error('Reset password error:', err);
        req.flash('error', 'Reset failed.');
        res.redirect('/user/reset-password');
    }
});

module.exports = router;