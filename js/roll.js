import { reconcileProfile } from './physique.js';
import { ageBracketMatchesFilter } from './fantasy.js';

export const SKIP_ARCHETYPE_TOP_LEVEL = new Set(['psychology_and_beliefs']);

export function getByPath(obj, path) {
    if (!obj || !path) return undefined;
    const keys = path.split('.');
    let cur = obj;
    for (const k of keys) {
        if (cur == null) return undefined;
        cur = cur[k];
    }
    return cur;
}

export function setByPath(obj, path, value) {
    const keys = path.split('.');
    let cur = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
        cur = cur[k];
    }
    cur[keys[keys.length - 1]] = value;
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function pickAge(arr, ageFilter) {
    const filtered = arr.filter(v => ageBracketMatchesFilter(v, ageFilter));
    return pick(filtered.length ? filtered : arr);
}

function pickAvoiding(arr, current, pickFn) {
    if (!arr.length) return current;
    if (arr.length === 1) return arr[0];
    let next = pickFn(arr);
    let guard = 0;
    while (next === current && guard < 10) {
        next = pickFn(arr);
        guard++;
    }
    return next;
}

export function rollCharacter(archetypes, { locks = [], previousProfile = null, ageFilter = 'any' } = {}) {
    const lockSet = new Set(locks);

    const traverse = (obj, pathParts, isRoot) => {
        const result = {};
        for (const key of Object.keys(obj)) {
            const path = [...pathParts, key].join('.');
            if (isRoot && SKIP_ARCHETYPE_TOP_LEVEL.has(key)) {
                result[key] = {};
                continue;
            }
            if (Array.isArray(obj[key])) {
                if (lockSet.has(path) && previousProfile) {
                    const locked = getByPath(previousProfile, path);
                    if (locked !== undefined && locked !== null) {
                        result[key] = locked;
                        continue;
                    }
                }
                result[key] = path === 'core_identity.age_bracket'
                    ? pickAge(obj[key], ageFilter)
                    : pick(obj[key]);
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                result[key] = traverse(obj[key], [...pathParts, key], false);
            }
        }
        return result;
    };

    return reconcileProfile(traverse(archetypes, [], true));
}

export function rerollPath(profile, archetypes, path, { ageFilter = 'any' } = {}) {
    const options = getByPath(archetypes, path);
    if (!Array.isArray(options) || options.length === 0) return profile;
    const current = getByPath(profile, path);
    const picker = path === 'core_identity.age_bracket'
        ? (arr) => pickAge(arr, ageFilter)
        : pick;
    const next = pickAvoiding(options, current, picker);
    const clone = JSON.parse(JSON.stringify(profile));
    setByPath(clone, path, next);
    return reconcileProfile(clone);
}
