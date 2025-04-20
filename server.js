const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bodyParser = require('body-parser');
const flash = require('connect-flash');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const spawner = require('child_process').spawn;
require('dotenv').config();

const connectDB = require('./config/db');
const User = require('./models/User');
const Student = require('./models/Student');
const Assignment = require('./models/Assignment');
const Score = require('./models/Score');
connectDB();

const aiService = require('./services/ai/ai_service');
aiService.initializeAI()

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({extended: false}));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({mongoUrl: process.env.MONGODB}),
    cookie: {maxAge: 86400000}
}));
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

// Auth
passport.use(new LocalStrategy(
    async (username, password, done) => {
        try {
            const user = await User.findOne({username});
            if (!user) return done(null, false, {message: 'Incorrect username or password.'});
            
            const isMatch = await user.comparePassword(password);
            if (!isMatch) return done(null, false, {message: 'Incorrect username or password.'});
            
            return done(null, user);
        } catch (err) {
            return done(err);
        }
    }
));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// Routes
app.get('/', (req, res) => {
    res.render('home');
});

app.get('/login', (req, res) => {
    res.render('login', {message: req.flash('error')});
});

app.post('/login',
    (req, res, next) => {
        passport.authenticate('local', (err, user, info) => {
            if (err) { return next(err); }
            if (!user) { 
                req.flash('error', info.message);
                return res.redirect('/login'); 
            }
            
            req.logIn(user, (err) => {
                if (err) {return next(err);}
                const userType = (user.type || '').toLowerCase().trim();
                if (userType === 'teacher') {
                    return res.redirect('/teacher');
                }
                else if (userType === 'student') {
                    return res.redirect('/student');
                }
                return res.redirect('/');
            });
        })(req, res, next);
    }
);

app.get('/register', (req, res) => {
    res.render('register', {message: req.flash('error')});
});

app.post('/register', async (req, res) => {
    try {
        const {username, password, type} = req.body;
        
        const existingUser = await User.findOne({username});
        if (existingUser) {
            req.flash('error', 'Username already exists');
            return res.redirect('/register');
        }
        
        const newUser = new User({username, password, type});
        await newUser.save();
        
        req.flash('success', 'Registration successful! Please login.');
        res.redirect('/login');
    } catch (err) {
        req.flash('error', 'Server error');
        res.redirect('/register');
    }
});

app.get('/teacher', ensureAuthenticated, (req, res) => {
    res.render('teacher', {user: req.user});
});
app.get('/student', ensureAuthenticated, (req, res) => {
    res.render('student', {user: req.user});
});

app.get('/dashboard', ensureAuthenticated, (req, res) => {
    res.render('dashboard', {user: req.user});
});
app.get('/form', ensureAuthenticated, (req, res) => {
    res.render('form', {user: req.user});
});

app.post('/form', ensureAuthenticated, async (req, res) => {
    try {
        console.log("Form submission received:", req.body);
        const {studentName, assignment, answer} = req.body;
        
        if (!studentName || !assignment || !answer) {
            console.error("Missing required fields");
            req.flash('error', 'All fields are required');
            return res.redirect('/form');
        }
        
        const userId = req.user._id;

        let student;
        student = await Student.findOne({name: studentName, teacherId: userId});
        if (!student) {
            student = new Student({name: studentName, teacherId: userId});
            await student.save();
        }

        let assignmentDoc;
        assignmentDoc = await Assignment.findOne({name: assignment, teacherId: userId});
        if (!assignmentDoc) {
            assignmentDoc = new Assignment({name: assignment, teacherId: userId});
            await assignmentDoc.save();
        }
        
        console.log("Calling AI service to evaluate essay...");
        try {
            const score = await aiService.evaluateEssay(answer);
            console.log("Essay evaluation complete. Score:", score);
            
            const newScore = new Score({studentId: student._id, assignmentId: assignmentDoc._id, teacherId: userId, score, answer});
            await newScore.save();
            
            req.flash('success', 'Form submitted successfully');
            res.render('form', {result: score, user: req.user});
        } catch (evalError) {
            console.error("Error evaluating essay:", evalError);
            req.flash('error', 'Error evaluating essay: ' + evalError.message);
            res.redirect('/form');
        }
    }
    catch (err) {
        console.error("Error during form submission:", err);
        req.flash('error', 'Server error');
        res.redirect('/form');
    }
});

function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
}

function userTypeMiddleware(userType) {
    if(userType == "teacher") {return '/teacher'}
    else if(userType == "student") {return '/student'}
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));