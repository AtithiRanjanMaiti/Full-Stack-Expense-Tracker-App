const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const app = express();
const SECRET = 'secretkey123';
// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/expense_tracker', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));
// User model
const UserSchema = new mongoose.Schema({
    username: String,
    password: String
});
const User = mongoose.model('User', UserSchema);
// Expense model
const ExpenseSchema = new mongoose.Schema({
    title: String,
    amount: Number,
    date: { type: Date, default: Date.now },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
});
const Expense = mongoose.model('Expense', ExpenseSchema);
// Auth middleware
function auth(req, res, next) {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: 'No token' });
    try {
        const decoded = jwt.verify(token, SECRET);
        req.userId = decoded.userId;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
}
// User Registration
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashed });
    await user.save();
    res.json({ message: 'Registered!' });
});
// User Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'User not found' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Wrong password' });

    const token = jwt.sign({ userId: user._id }, SECRET);
    res.json({ token });
});
// Routes for Expenses
app.get('/api/expenses', auth, async (req, res) => {
    const expenses = await Expense.find({ userId: req.userId });
    res.json(expenses);
});
app.post('/api/expenses', auth, async (req, res) => {
    const { title, amount } = req.body;
    const expense = new Expense({ title, amount, userId: req.userId });
    await expense.save();
    res.json({ message: 'Expense added!' });
});
app.put('/api/expenses/:id', auth, async (req, res) => {
    const { title, amount } = req.body;
    await Expense.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        { title, amount }
    );
    res.json({ message: 'Expense updated!' });
});
app.delete('/api/expenses/:id', auth, async (req, res) => {
    await Expense.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    res.json({ message: 'Expense deleted!' });
});
// Start server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});