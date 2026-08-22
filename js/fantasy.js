export const AGE_PRESETS = [
    { id: 'any', label: 'Any age', min: 18, max: 120 },
    { id: 'young', label: 'Young (18–29)', min: 18, max: 29 },
    { id: 'prime', label: 'Prime (30–41)', min: 30, max: 41 },
    { id: 'daddy', label: 'Daddy (36–59)', min: 36, max: 59 },
    { id: 'silver', label: 'Silver (50+)', min: 50, max: 120 }
];

export const HEAT_PRESETS = [
    { id: 'slow-burn', label: 'Slow burn' },
    { id: 'flirty', label: 'Flirty' },
    { id: 'filthy', label: 'Filthy' }
];

export const OPENER_PRESETS = [
    { id: 'strangers', label: 'Strangers' },
    { id: 'dating_match', label: 'Dating-app match' },
    { id: 'wrong_number', label: 'Wrong number' },
    { id: 'dads_friend', label: "Dad's friend" },
    { id: 'professor', label: 'Professor / mentor' },
    { id: 'boss', label: 'Boss' },
    { id: 'neighbor', label: 'Neighbor' }
];

export const DEFAULT_FANTASY = {
    ageFilter: 'any',
    heat: 'flirty',
    opener: 'strangers',
    userPersona: { name: '', age: '', addressAs: '', notes: '' }
};

export const DADDY_PRESET = {
    ageFilter: 'daddy',
    heat: 'filthy',
    opener: 'dads_friend'
};

export function ageBracketMinMax(label) {
    const nums = [...String(label || '').matchAll(/(\d+)/g)].map(m => parseInt(m[1], 10));
    if (nums.length >= 2) return { min: nums[0], max: nums[1] };
    if (nums.length === 1) {
        if (/\+|elder|patriarch/i.test(label || '')) return { min: nums[0], max: 120 };
        return { min: nums[0], max: nums[0] };
    }
    return { min: 30, max: 40 };
}

export function ageBracketMatchesFilter(label, filterId) {
    if (!filterId || filterId === 'any') return true;
    const preset = AGE_PRESETS.find(p => p.id === filterId);
    if (!preset) return true;
    const { min, max } = ageBracketMinMax(label);
    return min <= preset.max && max >= preset.min;
}

export function buildOpenerBlock(openerId, persona) {
    const you = persona?.name?.trim() ? persona.name.trim() : 'the person texting you';
    const knownName = persona?.name?.trim()
        ? `You know their name is ${persona.name.trim()}.`
        : 'You may not know their name yet unless the conversation implies it.';

    switch (openerId) {
        case 'dating_match':
            return `[RELATIONSHIP CONTEXT — DATING-APP MATCH]\nYou just matched with ${you} on a dating app. First-message energy: curious, a little performative, not yet intimate. ${knownName} You are not on a voice call.`;
        case 'wrong_number':
            return `[RELATIONSHIP CONTEXT — WRONG NUMBER]\n${you} texted what they think is a wrong number — it is yours. You can be amused, wary, or game. You did not match on an app. ${knownName}`;
        case 'dads_friend':
            return `[RELATIONSHIP CONTEXT — DAD'S FRIEND / OLDER FAMILY FRIEND]\nYou already have a connection through their family: you are a friend of their dad (or a similar older family friend). You are NOT strangers and you did NOT just match on an app. There may be a taboo charge. ${knownName} Stay in texting; do not jump to an in-person scene unless they steer there.`;
        case 'professor':
            return `[RELATIONSHIP CONTEXT — PROFESSOR / MENTOR]\nYou are their professor, TA, coach, or professional mentor. Power imbalance is part of the charge. Keep the medium as texting (office-hours texts, after-class messages). ${knownName}`;
        case 'boss':
            return `[RELATIONSHIP CONTEXT — BOSS]\nYou are their boss or manager. After-hours texts. Professional cover, personal undertow. ${knownName}`;
        case 'neighbor':
            return `[RELATIONSHIP CONTEXT — NEIGHBOR]\nYou live near ${you} — hallway, building, next door. You have seen each other. This is a text thread, not a knock on the door unless they take it there. ${knownName}`;
        default:
            return `[RELATIONSHIP CONTEXT — STRANGERS]\nAt the start of this conversation, you and the user are STRANGERS. You do not know each other. You may have just matched on a dating app, texted a wrong number, or are meeting online for the first time. Act accordingly. ${knownName}`;
    }
}

export function buildHeatBlock(heatId) {
    switch (heatId) {
        case 'slow-burn':
            return `[HEAT — SLOW BURN]\nKeep the conversation charged but paced. Earn intimacy. Do not jump to explicit sex in the first few messages unless the user clearly pushes there. Tension, subtext, and delay are the point. Consenting adults only.`;
        case 'filthy':
            return `[HEAT — FILTHY]\nYou are a consenting adult texting a consenting adult. Explicit sexual language, graphic dirty talk, and kink play that matches your profile are allowed and expected when the conversation goes there. Do not lecture, fade to black, or moralize. Never involve minors. Stay in the texting medium.`;
        default:
            return `[HEAT — FLIRTY]\nFlirt naturally in character. Sexual content is allowed when it fits your intimacy pacing and kinks. Consenting adults only. Never involve minors.`;
    }
}

export function buildUserPersonaBlock(persona) {
    const p = persona || {};
    const name = (p.name || '').trim();
    const age = (p.age || '').trim();
    const addressAs = (p.addressAs || '').trim();
    const notes = (p.notes || '').trim();
    if (!name && !age && !addressAs && !notes) {
        return `[THE PERSON YOU ARE TEXTING]\nYou do not have a detailed bio for them yet. Learn who they are from the conversation. Do not invent a name for them unless they give one.`;
    }
    const lines = ['[THE PERSON YOU ARE TEXTING]'];
    if (name) lines.push(`- Name: ${name}`);
    if (age) lines.push(`- Age: ${age}`);
    if (addressAs) lines.push(`- Call them: ${addressAs} (prefer this over generic pet names unless your nickname style conflicts — then blend)`);
    if (notes) lines.push(`- Notes / what they want from you: ${notes}`);
    lines.push('Treat this as canon for how you address and pursue them. Do not overwrite their name.');
    return lines.join('\n');
}

export function agePresetById(id) {
    return AGE_PRESETS.find(p => p.id === id) || AGE_PRESETS[0];
}

export function isYoutheningPerceivedAge(label) {
    return /younger|baby face/i.test(String(label || ''));
}

export function buildAgeLockInstruction(ageFilter, rolledBracket) {
    const preset = agePresetById(ageFilter);
    const rolled = rolledBracket || 'unspecified';
    if (!preset || preset.id === 'any') {
        return `AGE: Legal adult. Rolled bracket: ${rolled}. Face, hands, and skin must match that bracket. Never depict anyone under 18.`;
    }
    return [
        `AGE LOCK (HARD CANON — beats user concept, “college kid” stereotypes, and baby-face defaults):`,
        `- Settings lock: ${preset.label} (must read as ${preset.min}–${preset.max}).`,
        `- Rolled bracket (source of truth for face, neck, hands, hair aging): ${rolled}.`,
        `- Do not describe or depict him younger than ${preset.min} or older than ${preset.max}.`,
        `- No teen coding, no freshman/campus-kid face unless the lock is Young (18–29).`,
        `- Never depict anyone under 18.`
    ].join('\n');
}

export function buildOpenerGenerationNote(openerId) {
    switch (openerId) {
        case 'dating_match':
            return 'OPENER: Dating-app match. Visual: a first-profile photo — put-together, a little performative. Inner life: curious, not yet intimate.';
        case 'wrong_number':
            return 'OPENER: Wrong number. Visual: candid adult, not a catalog shot unless the rolled style says otherwise. Inner life: amused, wary, or game.';
        case 'dads_friend':
            return "OPENER: Dad's friend / older family friend. Visual: lived-in adult, not a campus kid. Inner life: he already knows their family; taboo charge is allowed. Do not write him as a stranger from a dating app.";
        case 'professor':
            return 'OPENER: Professor / mentor. Visual: academic or professional adult. Inner life: power imbalance, office-hours / after-class texts. Prefer interpreting profession toward teaching, coaching, or mentorship if the rolled job can stretch.';
        case 'boss':
            return 'OPENER: Boss / manager. Visual: workplace-adult competence. Inner life: after-hours professional cover with personal undertow. Prefer interpreting profession toward a senior/manager role if it can stretch.';
        case 'neighbor':
            return 'OPENER: Neighbor. Visual: residential casual, hallway/building energy. Inner life: they have seen each other; this is a text thread.';
        default:
            return 'OPENER: Strangers meeting over text. Visual can be candid or a first dating-app photo. Inner life: they do not know each other yet.';
    }
}

export function visualizerHeatNote(heatId) {
    if (heatId === 'filthy') {
        return 'HEAT IS FILTHY: revealing clothing, implied nudity, or locker-room/bedroom context is allowed if it fits. Stay STRICTLY HUMAN. Never use the word fur. Never depict anyone under 18.';
    }
    if (heatId === 'slow-burn') {
        return 'HEAT IS SLOW BURN: clothed, tension in posture and eye contact — not a bedroom/locker-room default. Stay STRICTLY HUMAN. Never depict anyone under 18.';
    }
    return 'HEAT IS FLIRTY: attractive and a little charged, mostly normal clothing unless the request says otherwise. Stay STRICTLY HUMAN. Never depict anyone under 18.';
}

export function buildFantasyCanonBlock({ ageFilter, heat, opener, userPersona, rolledAge } = {}) {
    const lines = [
        'FANTASY SETTINGS (HARD CANON for this generation — portrait AND inner life):',
        buildAgeLockInstruction(ageFilter, rolledAge),
        buildOpenerGenerationNote(opener),
        visualizerHeatNote(heat)
    ];
    const p = userPersona || {};
    const bits = [];
    if ((p.name || '').trim()) bits.push(`name ${(p.name || '').trim()}`);
    if ((p.age || '').trim()) bits.push(`age ${(p.age || '').trim()}`);
    if ((p.addressAs || '').trim()) bits.push(`he should call them "${(p.addressAs || '').trim()}"`);
    if ((p.notes || '').trim()) bits.push(`what they want: ${(p.notes || '').trim()}`);
    if (bits.length) {
        lines.push(`THE PERSON HE WILL TEXT (do not draw them in the portrait; shape status, pursuit, and backstory around them): ${bits.join('; ')}`);
    }
    return lines.join('\n');
}

export function loadFantasy() {
    try {
        const raw = localStorage.getItem('adonis_fantasy');
        if (!raw) return { ...DEFAULT_FANTASY, userPersona: { ...DEFAULT_FANTASY.userPersona } };
        const parsed = JSON.parse(raw);
        return {
            ageFilter: AGE_PRESETS.some(p => p.id === parsed.ageFilter) ? parsed.ageFilter : 'any',
            heat: HEAT_PRESETS.some(p => p.id === parsed.heat) ? parsed.heat : 'flirty',
            opener: OPENER_PRESETS.some(p => p.id === parsed.opener) ? parsed.opener : 'strangers',
            userPersona: {
                name: parsed.userPersona?.name || '',
                age: parsed.userPersona?.age || '',
                addressAs: parsed.userPersona?.addressAs || '',
                notes: parsed.userPersona?.notes || ''
            }
        };
    } catch {
        return { ...DEFAULT_FANTASY, userPersona: { ...DEFAULT_FANTASY.userPersona } };
    }
}

export function saveFantasy(fantasy) {
    localStorage.setItem('adonis_fantasy', JSON.stringify(fantasy));
}
