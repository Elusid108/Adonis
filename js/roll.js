import { reconcileProfile } from './physique.js';
import { ageBracketMatchesFilter, isYoutheningPerceivedAge } from './fantasy.js';

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

function pickPerceivedAge(arr, ageFilter) {
    if (!ageFilter || ageFilter === 'any' || ageFilter === 'young') return pick(arr);
    const filtered = arr.filter(v => !isYoutheningPerceivedAge(v));
    return pick(filtered.length ? filtered : arr);
}

function shouldKeepLock(path, locked, ageFilter) {
    if (locked === undefined || locked === null) return false;
    if (path === 'core_identity.age_bracket' && ageFilter && ageFilter !== 'any' && !ageBracketMatchesFilter(locked, ageFilter)) {
        return false;
    }
    if (path === 'identity_lineage.perceived_age_modifier' && ageFilter && ageFilter !== 'any' && ageFilter !== 'young' && isYoutheningPerceivedAge(locked)) {
        return false;
    }
    return true;
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
                    if (shouldKeepLock(path, locked, ageFilter)) {
                        result[key] = locked;
                        continue;
                    }
                }
                if (path === 'core_identity.age_bracket' || path === 'identity_lineage.chronological_age_range') {
                    result[key] = pickAge(obj[key], ageFilter);
                } else if (path === 'identity_lineage.perceived_age_modifier') {
                    result[key] = pickPerceivedAge(obj[key], ageFilter);
                } else {
                    result[key] = pick(obj[key]);
                }
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
    const picker = (path === 'core_identity.age_bracket' || path === 'identity_lineage.chronological_age_range')
        ? (arr) => pickAge(arr, ageFilter)
        : path === 'identity_lineage.perceived_age_modifier'
            ? (arr) => pickPerceivedAge(arr, ageFilter)
            : pick;
    const next = pickAvoiding(options, current, picker);
    const clone = JSON.parse(JSON.stringify(profile));
    setByPath(clone, path, next);
    return reconcileProfile(clone);
}
