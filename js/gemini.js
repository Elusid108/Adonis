const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const SAFETY_SETTINGS = [
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' }
];

export function geminiHeaders(apiKey) {
    return {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
    };
}

export function withSafety(payload) {
    return { ...payload, safetySettings: SAFETY_SETTINGS };
}

export function generateContentUrl(modelId) {
    return `${GEMINI_BASE}/models/${modelId}:generateContent`;
}

export function predictUrl(modelId) {
    return `${GEMINI_BASE}/models/${modelId}:predict`;
}

export function listModelsUrl() {
    return `${GEMINI_BASE}/models`;
}

export function extractTextFromGenerateContent(data) {
    const feedback = data?.promptFeedback;
    const block = feedback?.blockReason;
    const cand = data?.candidates?.[0];
    if (block && !cand) {
        const detail = feedback?.blockReasonMessage || feedback?.safetyRatings?.map(r => r.category).join(', ') || '';
        throw new Error(`Prompt blocked (${block})${detail ? ': ' + detail : ''}`);
    }
    if (!cand) throw new Error('No candidates returned from the text model.');

    const finish = cand.finishReason;
    const parts = cand.content?.parts || [];
    const text = parts
        .filter(p => typeof p.text === 'string' && !p.thought)
        .map(p => p.text)
        .join('');

    if (text.trim()) return text;
    if (finish === 'SAFETY') throw new Error('Response blocked by safety filters (finishReason: SAFETY).');
    if (finish === 'MAX_TOKENS') throw new Error('Response truncated (finishReason: MAX_TOKENS). Try a shorter prompt or another model.');
    if (finish && finish !== 'STOP') throw new Error(`Empty response (finishReason: ${finish}).`);
    throw new Error('Empty response from the text model.');
}

export function extractImageFromResponse(data) {
    if (data?.predictions?.[0]?.bytesBase64Encoded) {
        return data.predictions[0].bytesBase64Encoded;
    }
    const cand = data?.candidates?.[0];
    if (cand?.finishReason === 'SAFETY') throw new Error('SAFETY_BLOCK');
    const inline = cand?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
    if (inline) return inline;
    const block = data?.promptFeedback?.blockReason;
    if (block) throw new Error('SAFETY_BLOCK');
    throw new Error('SAFETY_BLOCK');
}

export const IMAGEN_PERMISSIVE_PARAMS = {
    sampleCount: 1,
    aspectRatio: '1:1',
    safetyFilterLevel: 'block_only_high',
    personGeneration: 'allow_adult'
};

export const GENERATE_CONTENT_TEXT_FALLBACKS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite'
];

export function isInteractionsOnlyError(message) {
    return /interactions api/i.test(String(message || ''));
}

export function isBlockedGenerateContentId(id) {
    const n = String(id || '').toLowerCase();
    return /deep-research|antigravity|computer-use|robotics|lyria|\btts\b|imagen|veo|embedding|aqa|omni/.test(n)
        || (n.includes('image') && !n.includes('flash-image'));
}

export function isStaleDatedPreview(id) {
    return /preview-\d{2}-\d{4}/.test(String(id || ''));
}

export function isLikelyInteractionsOnlyId(id) {
    const n = String(id || '').toLowerCase();
    return isBlockedGenerateContentId(id)
        || n.includes('omni')
        || /(^|-)(agent|live)($|-)/.test(n)
        || /^gemini-3(\.|-|$)/.test(n);
}

export function pickGenerateContentTextModel(textOpts, current) {
    const list = Array.isArray(textOpts) ? textOpts : [];
    const usable = list.filter(m => m && !isBlockedGenerateContentId(m.id) && !isStaleDatedPreview(m.id) && !isLikelyInteractionsOnlyId(m.id));
    const pool = usable.length ? usable : list;
    if (current && pool.some(m => m.id === current) && !isStaleDatedPreview(current) && !isLikelyInteractionsOnlyId(current)) {
        return current;
    }
    for (const id of GENERATE_CONTENT_TEXT_FALLBACKS) {
        const hit = pool.find(m => m.id === id);
        if (hit) return hit.id;
    }
    const stableFlash = pool.find(m => /gemini-2\.\d+-flash/.test(m.id) && !m.id.includes('preview'));
    if (stableFlash) return stableFlash.id;
    const anyFlash = pool.find(m => m.id.includes('flash') && !m.id.includes('preview'));
    return (anyFlash || pool[0] || list[0] || { id: GENERATE_CONTENT_TEXT_FALLBACKS[0] }).id;
}
