const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Sequelize, DataTypes } = require('sequelize');

const SequelizeStore = require('connect-session-sequelize')(session.Store);

const MESSAGES = {
    AUTH: {
        REQUIRED: MESSAGES.AUTH.REQUIRED,
        LOGIN_SHORT: MESSAGES.AUTH.LOGIN_SHORT,
        PASSWORD_SHORT: MESSAGES.AUTH.PASSWORD_SHORT,
        EXISTS: MESSAGES.AUTH.EXISTS,
        CREATED: MESSAGES.AUTH.CREATED,
        INVALID: MESSAGES.AUTH.INVALID,
        LOGGED_IN: MESSAGES.AUTH.LOGGED_IN,
        LOGGED_OUT: MESSAGES.AUTH.LOGGED_OUT
    },
    NOTES: {
        TITLE_REQUIRED: MESSAGES.NOTES.TITLE_REQUIRED,
        SAVED: MESSAGES.NOTES.SAVED,
        NOT_FOUND: MESSAGES.NOTES.NOT_FOUND,
        UPDATED: MESSAGES.NOTES.UPDATED,
        DELETED: MESSAGES.NOTES.DELETED
    },
    API: { NOT_FOUND: MESSAGES.API.NOT_FOUND }
};

const app = express();
const port = process.env.PORT || 3000;
const databasePath = path.join(__dirname, 'data', 'tasker.sqlite');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: databasePath,
    logging: false
});

const User = sequelize.define('User', {
    login: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            notEmpty: true,
            len: [4, 50]
        }
    },
    passwordHash: {
        type: DataTypes.STRING,
        allowNull: false
    }
});

const Note = sequelize.define('Note', {
    title: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [1, 120]
        }
    },
    content: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: ''
    }
});

User.hasMany(Note, {
    foreignKey: {
        allowNull: false,
        name: 'userId'
    },
    onDelete: 'CASCADE'
});

Note.belongsTo(User, {
    foreignKey: {
        allowNull: false,
        name: 'userId'
    }
});

const sessionStore = new SequelizeStore({
    db: sequelize,
    tableName: 'Sessions'
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(
    session({
        secret: process.env.SESSION_SECRET || 'tasker-dev-session-secret',
        store: sessionStore,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);

function normalizeLogin(value) {
    return String(value || '').trim().toLowerCase();
}

function sendPage(res, fileName) {
    return res.sendFile(path.join(__dirname, 'public', fileName));
}

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({
            error: MESSAGES.AUTH.REQUIRED
        });
    }

    next();
}

function sendError(res, status, message) {
    return res.status(status).json({ error: message });
}

function serializeUser(user) {
    return user ? { id: user.id, login: user.login } : null;
}

function serializeNote(note) {
    return {
        id: note.id,
        title: note.title,
        content: note.content,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt
    };
}

async function findOwnNote(noteId, userId) {
    return Note.findOne({
        where: {
            id: noteId,
            userId
        }
    });
}

app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/notes');
    }

    return res.redirect('/login');
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/notes');
    }

    return sendPage(res, 'login.html');
});

app.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect('/notes');
    }

    return sendPage(res, 'register.html');
});

app.get('/notes', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    return sendPage(res, 'notes.html');
});

app.get('/notes/new', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    return sendPage(res, 'editor.html');
});

app.get('/notes/:id/edit', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    return sendPage(res, 'editor.html');
});

app.get('/api/session', (req, res) => {
    res.json({
        user: req.session.user || null
    });
});

app.post('/api/register', async (req, res) => {
    const login = normalizeLogin(req.body.login);
    const password = String(req.body.password || '').trim();

    if (login.length < 4) {
        return sendError(res, 400, MESSAGES.AUTH.LOGIN_SHORT);
    }

    if (password.length < 4) {
        return sendError(res, 400, MESSAGES.AUTH.PASSWORD_SHORT);
    }

    const existingUser = await User.findOne({ where: { login } });
    if (existingUser) {
        return sendError(res, 409, MESSAGES.AUTH.EXISTS);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ login, passwordHash });

    req.session.user = serializeUser(user);
    res.status(201).json({
        message: MESSAGES.AUTH.CREATED,
        user: req.session.user
    });
});

app.post('/api/login', async (req, res) => {
    const login = normalizeLogin(req.body.login);
    const password = String(req.body.password || '');

    const user = await User.findOne({ where: { login } });
    if (!user) {
        return sendError(res, 401, MESSAGES.AUTH.INVALID);
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
        return sendError(res, 401, MESSAGES.AUTH.INVALID);
    }

    req.session.user = serializeUser(user);

    res.json({
        message: MESSAGES.AUTH.LOGGED_IN,
        user: req.session.user
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({
            message: MESSAGES.AUTH.LOGGED_OUT
        });
    });
});

app.get('/api/notes', requireAuth, async (req, res) => {
    const notes = await Note.findAll({
        where: { userId: req.session.user.id },
        order: [['updatedAt', 'DESC']]
    });

    res.json({
        notes: notes.map(serializeNote)
    });
});

app.post('/api/notes', requireAuth, async (req, res) => {
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();

    if (!title) {
        return sendError(res, 400, MESSAGES.NOTES.TITLE_REQUIRED);
    }

    const note = await Note.create({
        title,
        content,
        userId: req.session.user.id
    });

    res.status(201).json({
        message: MESSAGES.NOTES.SAVED,
        note: serializeNote(note)
    });
});

app.get('/api/notes/:id', requireAuth, async (req, res) => {
    const note = await findOwnNote(req.params.id, req.session.user.id);
    if (!note) {
        return sendError(res, 404, MESSAGES.NOTES.NOT_FOUND);
    }

    res.json({
        note: serializeNote(note)
    });
});

app.put('/api/notes/:id', requireAuth, async (req, res) => {
    const note = await findOwnNote(req.params.id, req.session.user.id);
    if (!note) {
        return sendError(res, 404, MESSAGES.NOTES.NOT_FOUND);
    }

    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    if (!title) {
        return sendError(res, 400, MESSAGES.NOTES.TITLE_REQUIRED);
    }

    note.title = title;
    note.content = content;
    await note.save();

    res.json({
        message: MESSAGES.NOTES.UPDATED,
        note: serializeNote(note)
    });
});

app.delete('/api/notes/:id', requireAuth, async (req, res) => {
    const note = await findOwnNote(req.params.id, req.session.user.id);
    if (!note) {
        return sendError(res, 404, MESSAGES.NOTES.NOT_FOUND);
    }

    await note.destroy();
    res.json({
        message: MESSAGES.NOTES.DELETED
    });
});

app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return sendError(res, 404, MESSAGES.API.NOT_FOUND);
    }

    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

async function start() {
    try {
        await sequelize.authenticate();
        await sequelize.sync();
        await sessionStore.sync();

        app.listen(port, () => {
            console.log(`Server running on http://localhost:${port}`);
        });
    } catch (error) {
        console.error('Failed to start application', error);
        process.exit(1);
    }
}

start();