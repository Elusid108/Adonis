const DB_NAME = 'adonis';
const DB_VERSION = 1;
export const HISTORY_CAP = 12;

let dbPromise = null;
let availability = { ok: true, warning: null };

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            const err = new Error('IndexedDB is not available in this browser.');
            availability = { ok: false, warning: err.message };
            reject(err);
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('session')) db.createObjectStore('session');
            if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('history')) db.createObjectStore('history');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
            availability = { ok: false, warning: req.error?.message || 'IndexedDB failed to open.' };
            reject(req.error || new Error(availability.warning));
        };
    });
    return dbPromise;
}

function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
}

export function getStorageAvailability() {
    return availability;
}

export async function initStorage() {
    try {
        await openDb();
        availability = { ok: true, warning: null };
        return availability;
    } catch (err) {
        availability = { ok: false, warning: err.message || 'Local save is unavailable (private mode?). Session will not persist.' };
        return availability;
    }
}

function reqToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function loadCurrentSession() {
    try {
        const db = await openDb();
        const tx = db.transaction('session', 'readonly');
        const value = await reqToPromise(tx.objectStore('session').get('current'));
        await txDone(tx);
        return value || null;
    } catch {
        return null;
    }
}

export async function saveCurrentSession(snapshot) {
    if (!availability.ok) return;
    const db = await openDb();
    const tx = db.transaction('session', 'readwrite');
    tx.objectStore('session').put(snapshot, 'current');
    await txDone(tx);
}

export function compactHistoryItem(item) {
    const style = item.visualStyle || 'photo';
    const active = (style === 'photo' && item.imagePhoto) || (style === '3d' && item.image3d) || item.image;
    return {
        ...item,
        image: active || item.image || null,
        imagePhoto: style === 'photo' ? (active || null) : null,
        image3d: style === '3d' ? (active || null) : null,
        chat: Array.isArray(item.chat) ? item.chat.slice(-40) : item.chat,
        rpUiChat: Array.isArray(item.rpUiChat) ? item.rpUiChat.slice(-80) : item.rpUiChat,
        rpApiHistory: Array.isArray(item.rpApiHistory) ? item.rpApiHistory.slice(-40) : item.rpApiHistory
    };
}

export function capHistory(items) {
    return (items || []).slice(0, HISTORY_CAP).map(compactHistoryItem);
}

export async function loadHistory() {
    try {
        const db = await openDb();
        const tx = db.transaction('history', 'readonly');
        const value = await reqToPromise(tx.objectStore('history').get('items'));
        await txDone(tx);
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
}

export async function saveHistory(items) {
    if (!availability.ok) return;
    const db = await openDb();
    const tx = db.transaction('history', 'readwrite');
    tx.objectStore('history').put(capHistory(items), 'items');
    await txDone(tx);
}

export async function listSaves() {
    try {
        const db = await openDb();
        const tx = db.transaction('saves', 'readonly');
        const items = await reqToPromise(tx.objectStore('saves').getAll());
        await txDone(tx);
        return (items || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch {
        return [];
    }
}

export async function putSave(slot) {
    const db = await openDb();
    const tx = db.transaction('saves', 'readwrite');
    tx.objectStore('saves').put(slot);
    await txDone(tx);
}

export async function deleteSave(id) {
    const db = await openDb();
    const tx = db.transaction('saves', 'readwrite');
    tx.objectStore('saves').delete(id);
    await txDone(tx);
}

export function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export function readJsonFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                resolve(JSON.parse(String(reader.result)));
            } catch (err) {
                reject(new Error('That file is not valid JSON.'));
            }
        };
        reader.onerror = () => reject(new Error('Could not read file.'));
        reader.readAsText(file);
    });
}
