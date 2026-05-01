const MESSAGES = {
    ERROR_REQUEST: MESSAGES.ERROR_REQUEST,
    CONFIRM_DELETE: MESSAGES.CONFIRM_DELETE,
    NOTE_DELETED: MESSAGES.NOTE_DELETED
};

const flashNode = document.getElementById('flash');
const page = document.body.dataset.page;
let isSubmitting = false;

function escapeHtml(value) {
    const chars = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value).replace(/[&<>"']/g, c => chars[c]);
}

function setFlash(type, message) {
    if (flashNode) {
        flashNode.innerHTML = message ? `<div class="flash flash-${escapeHtml(type)}">${escapeHtml(message)}</div>` : '';
    }
}

async function request(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        ...options
    });

    const hasJson = response.headers.get('content-type')?.includes('application/json');
    const payload = hasJson ? await response.json() : null;

    if (!response.ok) {
        throw new Error(payload?.error || MESSAGES.ERROR_REQUEST);
    }

    return payload;
}

function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
}

function getEditorNoteId() {
    return getQueryParam('id') || window.location.pathname.match(/^\/notes\/(\d+)\/edit$/)?.[1] || null;
}

function redirectTo(path) {
    window.location.href = path;
}

async function syncSession() {
    return (await request('/api/session'))?.user;
}

function bindAuthForm(formId, endpoint, successRedirect) {
    const form = document.getElementById(formId);
    if (!form) {
        return;
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isSubmitting) {
            return;
        }

        isSubmitting = true;
        setFlash(null, null);

        try {
            const formData = new FormData(form);
            const body = Object.fromEntries(formData.entries());
            await request(endpoint, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            redirectTo(successRedirect);
        } catch (error) {
            setFlash('error', error.message);
        } finally {
            isSubmitting = false;
        }
    });
}

function fillProfile(user) {
    const loginNode = document.getElementById('currentUserLogin');
    if (loginNode && user) {
        loginNode.textContent = user.login;
    }
}

async function bindLogoutButton() {
    const logoutButton = document.getElementById('logoutButton');
    if (!logoutButton) {
        return;
    }

    logoutButton.addEventListener('click', async () => {
        if (isSubmitting) {
            return;
        }

        isSubmitting = true;
        try {
            await request('/api/logout', {
                method: 'POST',
                body: JSON.stringify({})
            });
            redirectTo('/login');
        } catch (error) {
            setFlash('error', error.message);
        } finally {
            isSubmitting = false;
        }
    });
}

function renderNotes(notes) {
    const list = document.getElementById('notesList');
    if (!list) {
        return;
    }

    if (!notes.length) {
        list.innerHTML = `
            <div class="empty-state">
                <p>Заметок пока нет. Создайте первую запись.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = notes
        .map(
            (note) => `
                <article class="note-card">
                    <div>
                        <h3>${escapeHtml(note.title)}</h3>
                        <p class="note-meta">Обновлено: ${new Date(note.updatedAt).toLocaleString('ru-RU')}</p>
                    </div>
                    <p class="note-preview">${escapeHtml(note.content || 'Без текста')}</p>
                    <div class="button-row">
                        <a class="button-link" href="/notes/${note.id}/edit">Открыть</a>
                        <button type="button" class="button-danger" data-delete-note="${note.id}">Удалить</button>
                    </div>
                </article>
            `
        )
        .join('');
}

async function loadNotes() {
    const payload = await request('/api/notes');
    renderNotes(payload.notes);
}

async function bindNotesPage(user) {
    fillProfile(user);
    await bindLogoutButton();
    await loadNotes();

    document.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-delete-note]');
        if (!button || isSubmitting) {
            return;
        }

        if (!window.confirm(MESSAGES.CONFIRM_DELETE)) {
            return;
        }

        isSubmitting = true;
        try {
            await request(`/api/notes/${button.dataset.deleteNote}`, {
                method: 'DELETE'
            });
            await loadNotes();
            setFlash('success', MESSAGES.NOTE_DELETED);
        } catch (error) {
            setFlash('error', error.message);
        } finally {
            isSubmitting = false;
        }
    });
}

async function bindEditorPage(user) {
    fillProfile(user);
    await bindLogoutButton();

    const form = document.getElementById('noteForm');
    const deleteButton = document.getElementById('deleteNoteButton');
    const titleNode = document.getElementById('noteTitle');
    const contentNode = document.getElementById('noteContent');
    const headingNode = document.getElementById('editorHeading');
    const descriptionNode = document.getElementById('editorDescription');
    const noteId = getEditorNoteId();

    if (noteId) {
        const payload = await request(`/api/notes/${noteId}`);
        titleNode.value = payload.note.title;
        contentNode.value = payload.note.content;
        headingNode.textContent = 'Редактирование заметки';
        descriptionNode.textContent = 'Обновите запись и сохраните изменения на сервере.';
        if (deleteButton) {
            deleteButton.hidden = false;
            deleteButton.dataset.noteId = noteId;
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (isSubmitting) {
            return;
        }

        isSubmitting = true;
        setFlash(null, null);

        try {
            const body = {
                title: titleNode.value,
                content: contentNode.value
            };
            await request(noteId ? `/api/notes/${noteId}` : '/api/notes', {
                method: noteId ? 'PUT' : 'POST',
                body: JSON.stringify(body)
            });
            redirectTo('/notes');
        } catch (error) {
            setFlash('error', error.message);
        } finally {
            isSubmitting = false;
        }
    });

    if (deleteButton) {
        deleteButton.addEventListener('click', async () => {
            if (!deleteButton.dataset.noteId || isSubmitting) {
                return;
            }

            if (!window.confirm(MESSAGES.CONFIRM_DELETE)) {
                return;
            }

            isSubmitting = true;
            try {
                await request(`/api/notes/${deleteButton.dataset.noteId}`, {
                    method: 'DELETE'
                });
                redirectTo('/notes');
            } catch (error) {
                setFlash('error', error.message);
            } finally {
                isSubmitting = false;
            }
        });
    }
}

function showFlashFromQuery() {
    if (getQueryParam('error')) setFlash('error', getQueryParam('error'));
    else if (getQueryParam('message')) setFlash('success', getQueryParam('message'));
}

async function bootstrap() {
    try {
        showFlashFromQuery();
        const user = await syncSession();

        const isGuestPage = ['login', 'register'].includes(page);
        const isAuthPage = ['notes', 'editor'].includes(page);

        if (isGuestPage && user) return redirectTo('/notes');
        if (isAuthPage && !user) return redirectTo('/login');

        const pageHandlers = {
            login: () => bindAuthForm('loginForm', '/api/login', '/notes'),
            register: () => bindAuthForm('registerForm', '/api/register', '/notes'),
            notes: () => bindNotesPage(user),
            editor: () => bindEditorPage(user)
        };

        if (pageHandlers[page]) {
            await pageHandlers[page]();
        }
    } catch (error) {
        setFlash('error', error.message);
    }
}

bootstrap();