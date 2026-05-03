require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Environment variables ────────────────────────────────────────────────────
const SECRET    = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/expense_tracker';
const PORT      = process.env.PORT || 3000;

if (!SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set.');
    process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
    console.error('FATAL: ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── MongoDB connection ───────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => { console.error('MongoDB connection error:', err); process.exit(1); });

// ── Models ───────────────────────────────────────────────────────────────────
const CATEGORIES = [
    'Food & Dining', 'Transport', 'Housing', 'Utilities', 'Healthcare',
    'Entertainment', 'Shopping', 'Education', 'Travel', 'Savings',
    'Investment', 'Insurance', 'Personal Care', 'Gifts & Donations', 'General'
];

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 30 },
    password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

const ExpenseSchema = new mongoose.Schema({
    title:    { type: String, required: true, trim: true, maxlength: 100 },
    amount:   { type: Number, required: true, min: 0 },
    category: { type: String, trim: true, enum: CATEGORIES, default: 'General' },
    date:     { type: Date, default: Date.now },
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
});
const Expense = mongoose.model('Expense', ExpenseSchema);

// ── Auth middleware ───────────────────────────────────────────────────────────
function auth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, SECRET);
        req.userId = decoded.userId;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}

// ── Validation helpers ────────────────────────────────────────────────────────
function validateRegister({ username, password }) {
    if (!username || typeof username !== 'string' || username.trim().length < 3)
        return 'Username must be at least 3 characters';
    if (!password || typeof password !== 'string' || password.length < 6)
        return 'Password must be at least 6 characters';
    return null;
}

function validateExpense({ title, amount }) {
    if (!title || typeof title !== 'string' || title.trim().length === 0)
        return 'Title is required';
    if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) < 0)
        return 'Amount must be a non-negative number';
    return null;
}

// ── Auth routes ───────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
    try {
        const err = validateRegister(req.body);
        if (err) return res.status(400).json({ error: err });

        const { username, password } = req.body;
        const existing = await User.findOne({ username: username.trim() });
        if (existing) return res.status(409).json({ error: 'Username already taken' });

        const hashed = await bcrypt.hash(password, 10);
        const user = new User({ username: username.trim(), password: hashed });
        await user.save();
        res.status(201).json({ message: 'Registered successfully!' });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ error: 'Username and password are required' });

        const user = await User.findOne({ username: username.trim() });
        if (!user) return res.status(401).json({ error: 'Invalid credentials' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ userId: user._id }, SECRET, { expiresIn: '7d' });
        res.json({ token });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── Expense routes ────────────────────────────────────────────────────────────
app.get('/api/expenses', auth, async (req, res) => {
    try {
        const page  = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, parseInt(req.query.limit) || 20);
        const skip  = (page - 1) * limit;

        const [expenses, total] = await Promise.all([
            Expense.find({ userId: req.userId }).sort({ date: -1 }).skip(skip).limit(limit),
            Expense.countDocuments({ userId: req.userId })
        ]);
        res.json({ expenses, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
        console.error('Get expenses error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/expenses', auth, async (req, res) => {
    try {
        const validErr = validateExpense(req.body);
        if (validErr) return res.status(400).json({ error: validErr });

        const { title, amount, category } = req.body;
        const expense = new Expense({
            title: title.trim(),
            amount: Number(amount),
            category: CATEGORIES.includes(category) ? category : 'General',
            userId: req.userId
        });
        await expense.save();
        res.status(201).json({ message: 'Expense added!', expense });
    } catch (err) {
        console.error('Add expense error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/expenses/:id', auth, async (req, res) => {
    try {
        const validErr = validateExpense(req.body);
        if (validErr) return res.status(400).json({ error: validErr });

        const { title, amount, category } = req.body;
        const updated = await Expense.findOneAndUpdate(
            { _id: req.params.id, userId: req.userId },
            {
                title: title.trim(),
                amount: Number(amount),
                category: CATEGORIES.includes(category) ? category : 'General'
            },
            { new: true }
        );
        if (!updated) return res.status(404).json({ error: 'Expense not found' });
        res.json({ message: 'Expense updated!', expense: updated });
    } catch (err) {
        console.error('Update expense error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/expenses/:id', auth, async (req, res) => {
    try {
        const deleted = await Expense.findOneAndDelete({ _id: req.params.id, userId: req.userId });
        if (!deleted) return res.status(404).json({ error: 'Expense not found' });
        res.json({ message: 'Expense deleted!' });
    } catch (err) {
        console.error('Delete expense error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── AI: Auto-categorise an expense ───────────────────────────────────────────
// POST /api/ai/categorise  { title, amount? }  → { category }
app.post('/api/ai/categorise', auth, async (req, res) => {
    try {
        const { title, amount } = req.body;
        if (!title) return res.status(400).json({ error: 'Title is required' });

        const message = await anthropic.messages.create({
            model: 'claude-opus-4-5',
            max_tokens: 64,
            system: `You are a financial categorisation assistant.
Given an expense title and optional amount, return ONLY the single best matching category from this list, with no other text:
${CATEGORIES.join(', ')}`,
            messages: [{
                role: 'user',
                content: `Expense: "${title}"${amount ? `, Amount: $${amount}` : ''}`
            }]
        });

        const raw      = message.content[0].text.trim();
        const category = CATEGORIES.includes(raw) ? raw : 'General';
        res.json({ category });
    } catch (err) {
        console.error('AI categorise error:', err);
        res.status(500).json({ error: 'AI categorisation failed' });
    }
});

// ── AI: Financial advice (streaming) ─────────────────────────────────────────
// POST /api/ai/advice  { question }  → SSE stream of { text } chunks
app.post('/api/ai/advice', auth, async (req, res) => {
    try {
        const { question } = req.body;
        if (!question || question.trim().length === 0)
            return res.status(400).json({ error: 'Question is required' });

        // Fetch user's recent expenses for context
        const expenses = await Expense.find({ userId: req.userId })
            .sort({ date: -1 })
            .limit(50);

        const summary = {};
        let totalSpent = 0;
        for (const e of expenses) {
            summary[e.category] = (summary[e.category] || 0) + e.amount;
            totalSpent += e.amount;
        }

        const summaryText = Object.entries(summary)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, amt]) => `  • ${cat}: $${amt.toFixed(2)}`)
            .join('\n');

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const stream = await anthropic.messages.create({
            model: 'claude-opus-4-5',
            max_tokens: 1024,
            stream: true,
            system: `You are a friendly, practical personal finance advisor.
You have access to the user's recent spending data.
Give specific, actionable advice based on their actual spending patterns.
Keep responses concise (3-5 sentences), warm, and non-judgmental.
Format numbers as currency. Do not give legal or investment advice.`,
            messages: [{
                role: 'user',
                content: `My recent spending summary (last 50 expenses, total $${totalSpent.toFixed(2)}):\n${summaryText || '  No expenses recorded yet.'}\n\nMy question: ${question}`
            }]
        });

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
            }
        }
        res.write('data: [DONE]\n\n');
        res.end();
    } catch (err) {
        console.error('AI advice error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'AI advice failed' });
    }
});

// ── AI: Quick spending insight ────────────────────────────────────────────────
// GET /api/ai/insight  → { insight }
app.get('/api/ai/insight', auth, async (req, res) => {
    try {
        const expenses = await Expense.find({ userId: req.userId })
            .sort({ date: -1 })
            .limit(50);

        if (expenses.length === 0)
            return res.json({ insight: "No expenses yet — start tracking to get personalised insights!" });

        const summary = {};
        let totalSpent = 0;
        for (const e of expenses) {
            summary[e.category] = (summary[e.category] || 0) + e.amount;
            totalSpent += e.amount;
        }
        const topCategory = Object.entries(summary).sort((a, b) => b[1] - a[1])[0];
        const summaryText = Object.entries(summary)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, amt]) => `${cat}: $${amt.toFixed(2)}`)
            .join(', ');

        const message = await anthropic.messages.create({
            model: 'claude-opus-4-5',
            max_tokens: 120,
            system: `You are a personal finance coach. Write a single short insight (max 2 sentences) about the user's spending. Be specific, encouraging, and actionable. No bullet points.`,
            messages: [{
                role: 'user',
                content: `Total spent: $${totalSpent.toFixed(2)}. Top category: ${topCategory[0]} ($${topCategory[1].toFixed(2)}). Breakdown: ${summaryText}`
            }]
        });

        res.json({ insight: message.content[0].text.trim() });
    } catch (err) {
        console.error('AI insight error:', err);
        res.status(500).json({ error: 'Could not generate insight' });
    }
});

// ── Categories list ───────────────────────────────────────────────────────────
app.get('/api/categories', (_req, res) => res.json({ categories: CATEGORIES }));

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
