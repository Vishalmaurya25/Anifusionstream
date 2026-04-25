const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const sanitizeHtml = require('sanitize-html'); // npm i sanitize-html express-rate-limit
const { clearSessionCache } = require('../middleware/auth');


// Models
const User = require('../models/User');
const OTP = require('../models/OTP');

// ==========================================
// 1. EMAIL CONFIGURATION
// ==========================================
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ==========================================
// 2. RATE LIMITERS
// ==========================================
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3, // 3 OTP requests per 15 min
    message: 'Too many OTP requests. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5, // 5 login attempts per 15 min
    message: 'Too many login attempts. Please try again later.',
});

// ==========================================
// 3. HELPER FUNCTIONS
// ==========================================
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
    const subject = isReset? 'Reset Your Password' : 'Verify Your Email';
    const heading = isReset? 'Password Reset Request' : 'Email Verification';
    const actionText = isReset? 'reset your password' : 'complete your registration';
    const iconColor = isReset? '#f59e0b' : '#3b82f6';
    const iconBg = isReset? 'rgba(245, 158, 11, 0.1)' : 'rgba(59, 130, 246, 0.1)';
    const icon = isReset? '🔐' : '✉️';

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
        <body style="margin: 0; padding: 0; background-color: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
                <tr>
                    <td align="center">
                        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
                            <tr>
                                <td style="background: linear-gradient(135deg, ${isReset? '#f59e0b 0%, #ec4899' : '#3b82f6 0%, #06b6d4'} 100%); padding: 40px 30px; text-align: center;">
                                    <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 16px; display: inline-block; line-height: 60px; margin-bottom: 16px;">
                                        <span style="font-size: 32px;">${icon}</span>
                                    </div>
                                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 900; letter-spacing: -0.5px;">
                                        AniFusion
                                    </h1>
                                    <p style="margin: 8px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
                                        ${heading}
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 40px 30px;">
                                    <h2 style="margin: 0 0 16px 0; color: #1f2937; font-size: 22px; font-weight: 800;">
                                        Hello, ${sanitizeHtml(username)}!
                                    </h2>
                                    <p style="margin: 0 0 24px 0; color: #6b7280; font-size: 15px; line-height: 1.6;">
                                        Use the verification code below to ${actionText}. This code will expire in 5 minutes.
                                    </p>
                                    <div style="background: ${iconBg}; border: 2px dashed ${iconColor}; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                                        <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">
                                            Your Verification Code
                                        </p>
                                        <h1 style="margin: 0; color: #1f2937; font-size: 42px; font-weight: 900; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                                            ${otp}
                                        </h1>
                                    </div>
                                    <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 24px 0;">
                                        <p style="margin: 0; color: #92400e; font-size: 13px; line-height: 1.5;">
                                            <strong>⚠️ Security Notice:</strong> Never share this code with anyone. AniFusion team will never ask for your OTP.
                                        </p>
                                    </div>
                                    <p style="margin: 24px 0 0 0; color: #9ca3af; font-size: 13px; line-height: 1.6;">
                                        If you didn't request this ${isReset? 'password reset' : 'verification'}, please ignore this email or contact support if you have concerns.
                                    </p>
                                </td>
                            </tr>
                            <tr>
                                <td style="background-color: #f9fafb; padding: 24px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                                    <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 13px; font-weight: 600;">
                                        Need help? Contact us at anifusionstream@gmail.com
                                    </p>
                                    <p style="margin: 0; color: #9ca3af; font-size: 12px;">
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

// ==========================================
// 3. REGISTRATION & VERIFICATION
// ==========================================

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
        const emailExists = await User.findOne({ email });
        if (emailExists) {
            req.flash('error', 'Email already registered.');
            return res.redirect('/user/register');
        }

        const usernameExists = await User.findOne({ username });
        if (usernameExists) {
            req.flash('error', 'Username already exists.');
            return res.redirect('/user/register');
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const otp = generateOTP();

        await OTP.deleteMany({ email });
        await OTP.create({ email, otp, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
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

router.post('/register-verify-otp', async (req, res) => {
    try {
        let { otp } = req.body;
        otp = otp.trim();

        const tempUser = req.session.tempUser;
        if (!tempUser) return res.redirect('/user/register');

        const record = await OTP.findOneAndDelete({
            email: tempUser.email,
            otp,
            expiresAt: { $gt: new Date() }
        });

        if (!record) {
            req.flash('error', 'Invalid or expired code.');
            return res.redirect('/user/register-verify-otp');
        }

        try {
            const user = await User.create(tempUser);
            delete req.session.tempUser;

            // Regenerate session to prevent fixation
            req.session.regenerate((err) => {
                if (err) throw err;
                req.session.isUserAuthenticated = true;
                req.session.userId = user._id.toString();
                req.session.username = user.username;
                req.session.save(() => {
                    req.flash('success', 'Account verified! Welcome.');
                    res.redirect('/');
                });
            });
        } catch (err) {
            if (err.code === 11000) {
                delete req.session.tempUser;
                const field = Object.keys(err.keyPattern)[0];
                req.flash('error', `${field.charAt(0).toUpperCase() + field.slice(1)} already taken. Please register again.`);
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
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
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

// ==========================================
// 4. LOGIN & LOGOUT
// ==========================================

router.get('/login', (req, res) => res.render('user-login'));

router.post('/login', loginLimiter, async (req, res) => {
    try {
        let { email, password } = req.body;
        email = email.toLowerCase().trim();

        if (!validateEmail(email) ||!password) {
            req.flash('error', 'Invalid email or password.');
            return res.redirect('/user/login');
        }

        const user = await User.findOne({ email });
        if (!user ||!(await bcrypt.compare(password, user.password))) {
            req.flash('error', 'Invalid email or password.');
            return res.redirect('/user/login');
        }

        // Regenerate session to prevent fixation
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
            if (err) {
                console.error("User Session Destroy Error:", err);
            }
            clearSessionCache(sessionId); // Clear auth cache
            res.clearCookie('connect.sid', { path: '/' });
            res.redirect('/user/login');
        });
    } else {
        res.clearCookie('connect.sid', { path: '/' });
        res.redirect('/user/login');
    }
});

// ==========================================
// 5. PASSWORD RECOVERY
// ==========================================

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

        // Always return same message to prevent user enumeration
        if (user) {
            const otp = generateOTP();
            await OTP.deleteMany({ email });
            await OTP.create({
                email,
                otp,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000)
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
            email,
            otp,
            expiresAt: { $gt: new Date() }
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
            expiresAt: new Date(Date.now() + 5 * 60 * 1000)
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
    if (!req.session.resetEmail ||!req.session.otpVerified) return res.redirect('/user/forgot-password');
    res.render('user-reset-password');
});

router.post('/reset-password', async (req, res) => {
    try {
        const { newPassword, confirmPassword } = req.body;
        const email = req.session.resetEmail;

        if (!req.session.otpVerified ||!email) {
            req.flash('error', 'Session expired.');
            return res.redirect('/user/forgot-password');
        }

        if (newPassword!== confirmPassword) {
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