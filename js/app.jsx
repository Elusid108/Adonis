import React, { useState, useEffect, useRef } from 'https://esm.sh/react@18.2.0';
import { createRoot } from 'https://esm.sh/react-dom@18.2.0/client';
import {
    Send, RefreshCw, Settings, AlertCircle, Copy, Check, Sparkles, User,
    Image as ImageIcon, MessageSquare, Download, History, X,
    Maximize2, ShieldAlert, ArrowRight, Dices, Layers, Type, Loader2, Eraser,
    LayoutGrid, Heart, MessageCircle, Flame, Fingerprint, Paperclip, Palette, FileDown,
    BookOpen, Mic, Lock, Unlock, Save, Upload, Trash2
} from 'https://esm.sh/lucide-react@0.303.0';

import { buildPhysicalGroundTruthBlock, reconcileProfile, VISUAL_TRAIT_PATHS } from './js/physique.js';
import {
    geminiHeaders, withSafety, generateContentUrl, predictUrl, listModelsUrl,
    extractTextFromGenerateContent, extractImageFromResponse, IMAGEN_PERMISSIVE_PARAMS,
    GENERATE_CONTENT_TEXT_FALLBACKS, isInteractionsOnlyError, isBlockedGenerateContentId,
    isStaleDatedPreview, isLikelyInteractionsOnlyId, pickGenerateContentTextModel
} from './js/gemini.js';
import { rollCharacter, rerollPath, getByPath } from './js/roll.js';
import {
    AGE_PRESETS, HEAT_PRESETS, OPENER_PRESETS, DADDY_PRESET, loadFantasy, saveFantasy,
    buildOpenerBlock, buildHeatBlock, buildUserPersonaBlock, buildFantasyCanonBlock
} from './js/fantasy.js';
import {
    initStorage, getStorageAvailability, loadCurrentSession, saveCurrentSession,
    loadHistory, saveHistory, capHistory, listSaves, putSave, deleteSave,
    downloadJson, readJsonFile, HISTORY_CAP
} from './js/storage.js';

async function loadAppData() {
    const [descriptors, config, visPrompt, rpPromptTemplate] = await Promise.all([
        fetch('data/descriptors.json').then(r => r.json()),
        fetch('data/config.json').then(r => r.json()),
        fetch('data/prompts/visualizer-system.txt').then(r => r.text()),
        fetch('data/prompts/roleplay-system.txt').then(r => r.text()),
    ]);

    const archetypes = descriptors.archetypes;
    archetypes.core_identity.first_name = descriptors.first_names;

    const mergedConfig = { ...config, style_sections: descriptors.style_sections };

    return { archetypes, config: mergedConfig, visPrompt, rpPromptTemplate };
}

function fillTemplate(template, profile) {
    return template.replace(/\{\{(\S+?)\}\}/g, (_, path) => {
        const keys = path.split('.');
        let val = profile;
        for (const k of keys) {
            if (val == null) return '';
            val = val[k];
        }
        if (val == null) return '';
        if (Array.isArray(val)) {
            return val.map((line, i) => `${i + 1}. ${line}`).join('\n');
        }
        if (typeof val === 'object') return '';
        return String(val);
    });
}

const PERSONA_DEPTH_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        mbti: { type: 'string' },
        enneagram: { type: 'string' },
        moral_alignment: { type: 'string' },
        unconscious_fear: { type: 'string' },
        the_lie_they_believe: { type: 'string' },
        primary_vice: { type: 'string' },
        primary_virtue: { type: 'string' },
        short_backstory: { type: 'string' },
        behavioral_rules: {
            type: 'array',
            items: { type: 'string' },
            minItems: 5,
            maxItems: 7
        }
    },
    required: ['mbti', 'enneagram', 'moral_alignment', 'unconscious_fear', 'the_lie_they_believe', 'primary_vice', 'primary_virtue', 'short_backstory', 'behavioral_rules']
};

function parsePersonaDepthJson(text) {
    if (!text || typeof text !== 'string') return null;
    let s = text.trim();
    const fence = s.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    if (fence) s = fence[1].trim();
    try {
        return JSON.parse(s);
    } catch {
        return null;
    }
}

function normalizePersonaDepth(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const rules = Array.isArray(d.behavioral_rules)
        ? d.behavioral_rules.filter(r => typeof r === 'string' && r.trim()).slice(0, 7)
        : [];
    while (rules.length < 5) {
        rules.push('Stay consistent with the established physical and social context.');
    }
    return {
        mbti: typeof d.mbti === 'string' ? d.mbti : '',
        enneagram: typeof d.enneagram === 'string' ? d.enneagram : '',
        moral_alignment: typeof d.moral_alignment === 'string' ? d.moral_alignment : '',
        unconscious_fear: typeof d.unconscious_fear === 'string' ? d.unconscious_fear : '',
        the_lie_they_believe: typeof d.the_lie_they_believe === 'string' ? d.the_lie_they_believe : '',
        primary_vice: typeof d.primary_vice === 'string' ? d.primary_vice : '',
        primary_virtue: typeof d.primary_virtue === 'string' ? d.primary_virtue : '',
        short_backstory: typeof d.short_backstory === 'string' ? d.short_backstory : '',
        behavioral_rules: rules
    };
}

const applyStyleToPrompt = (promptText, style, styleSections) => {
    const text = promptText ?? '';
    const section = styleSections[style];
    if (!section) return text;
    const styleRegex = /\[Style[^\]]*\][\s\S]*?(?=\n\[|\n\s*$)/;
    if (styleRegex.test(text)) {
        return text.replace(styleRegex, section);
    }
    return section + '\n\n' + text;
};

const lc = (v) => (typeof v === 'string' ? v.toLowerCase() : '');
const str = (v, fallback = '—') => (v == null || v === '' ? fallback : String(v));
const firstBit = (v, fallback = '—') => {
    if (typeof v !== 'string' || !v) return fallback;
    return v.split('/')[0];
};

const DEFAULT_VIS_WELCOME = { role: 'system', text: 'Welcome to the Adonis Engine Studio. Enter your API Key in settings, then click "Roll Character" to begin.', type: 'text' };

const loadLockedPaths = () => {
    try {
        const raw = JSON.parse(localStorage.getItem('adonis_locked_paths') || '[]');
        return Array.isArray(raw) ? raw.filter(p => typeof p === 'string') : [];
    } catch {
        return [];
    }
};

const AdonisEngineApp = ({ appData }) => {
    const { archetypes: MERGED_ARCHETYPES, config, visPrompt: DEFAULT_SYSTEM_PROMPT, rpPromptTemplate } = appData;
    const APP_VERSION = config.app_version;
    const STYLE_SECTIONS = config.style_sections;
    const CANVAS_TEXT_MODELS = config.default_text_models;
    const CANVAS_IMAGE_MODELS = config.default_image_models;
    const initialFantasy = loadFantasy();

    const [apiKey, setApiKey] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [settingsTab, setSettingsTab] = useState('studio');
    const [showHistory, setShowHistory] = useState(false);
    const [showDossier, setShowDossier] = useState(false);
    const [activeMainTab, setActiveMainTab] = useState('visualizer');
    const [fullScreenImageUrl, setFullScreenImageUrl] = useState(null);
    const [error, setError] = useState(null);
    const [storageWarning, setStorageWarning] = useState(null);
    const [portraitStale, setPortraitStale] = useState(false);

    const [availableTextModels, setAvailableTextModels] = useState(CANVAS_TEXT_MODELS);
    const [availableImageModels, setAvailableImageModels] = useState(CANVAS_IMAGE_MODELS);
    const [selectedTextModel, setSelectedTextModel] = useState(CANVAS_TEXT_MODELS[0].id);
    const [selectedImageModel, setSelectedImageModel] = useState(CANVAS_IMAGE_MODELS[0].id);
    const [isLoadingModels, setIsLoadingModels] = useState(false);

    const [visualStyle, setVisualStyle] = useState(() => localStorage.getItem('adonis_visual_style') || 'photo');
    const [layout, setLayout] = useState(() => {
        const cached = localStorage.getItem('adonis_layout');
        return (cached === 'chat-left' || cached === 'chat-right' || cached === 'chat-bottom') ? cached : 'chat-bottom';
    });

    const [ageFilter, setAgeFilter] = useState(initialFantasy.ageFilter);
    const [heat, setHeat] = useState(initialFantasy.heat);
    const [opener, setOpener] = useState(initialFantasy.opener);
    const [userPersona, setUserPersona] = useState(initialFantasy.userPersona);
    const [lockedPaths, setLockedPaths] = useState(loadLockedPaths);

    const [personaProfile, setPersonaProfile] = useState(null);
    const [systemPrompt, setSystemPrompt] = useState('');
    const [currentPrompt, setCurrentPrompt] = useState('');

    const [generatedImage, setGeneratedImage] = useState(null);
    const [generatedImagePhoto, setGeneratedImagePhoto] = useState(null);
    const [generatedImage3d, setGeneratedImage3d] = useState(null);

    const [isGlobalRolling, setIsGlobalRolling] = useState(false);
    const [isVisTextLoading, setIsVisTextLoading] = useState(false);
    const [isVisImageLoading, setIsVisImageLoading] = useState(false);
    const [isVisSanitizing, setIsVisSanitizing] = useState(false);
    const [isChatTyping, setIsChatTyping] = useState(false);
    const [isRerollingPsych, setIsRerollingPsych] = useState(false);

    const [generationHistory, setGenerationHistory] = useState([]);
    const [saveSlots, setSaveSlots] = useState([]);

    const [visChatHistory, setVisChatHistory] = useState([DEFAULT_VIS_WELCOME]);
    const [visUserInput, setVisUserInput] = useState('');
    const [characterConcept, setCharacterConcept] = useState('');

    const [roleplayApiHistory, setRoleplayApiHistory] = useState([]);
    const [roleplayUiChat, setRoleplayUiChat] = useState([]);
    const [roleplayUserInput, setRoleplayUserInput] = useState('');
    const [pendingImage, setPendingImage] = useState(null);

    const [copyFeedback, setCopyFeedback] = useState({});

    const visChatEndRef = useRef(null);
    const rpChatEndRef = useRef(null);
    const rpInputRef = useRef(null);
    const fileInputRef = useRef(null);
    const jsonImportRef = useRef(null);
    const skipSaveRef = useRef(true);

    const generateRoleplayPrompt = (profile) => fillTemplate(rpPromptTemplate, {
        ...profile,
        opener_block: buildOpenerBlock(opener, userPersona),
        user_persona_block: buildUserPersonaBlock(userPersona),
        heat_block: buildHeatBlock(heat)
    });

    const composeSystemPrompt = (profile, visualPromptText) => {
        if (!profile) return '';
        const base = generateRoleplayPrompt(profile);
        if (!visualPromptText) return base;
        return `${base}\n\n[VISUAL APPEARANCE - ABSOLUTE OVERRIDE]\nYour physical appearance is strictly defined by the following visual description. If any of your base profile traits conflict with this visual description, the visual description completely overrides them.\n\n${visualPromptText}`;
    };

    const fantasyCanonFor = (profile) => buildFantasyCanonBlock({
        ageFilter,
        heat,
        opener,
        userPersona,
        rolledAge: profile?.core_identity?.age_bracket
    });

    const buildSnapshot = () => ({
        app_version: APP_VERSION,
        personaProfile,
        lockedPaths,
        currentPrompt,
        systemPrompt,
        visChatHistory,
        roleplayApiHistory,
        roleplayUiChat,
        generatedImage,
        generatedImagePhoto,
        generatedImage3d,
        visualStyle,
        selectedTextModel,
        selectedImageModel,
        characterConcept,
        layout,
        portraitStale,
        fantasy: { ageFilter, heat, opener, userPersona }
    });

    const applySnapshot = (snap) => {
        if (!snap || typeof snap !== 'object') return;
        if (snap.personaProfile) setPersonaProfile(reconcileProfile(JSON.parse(JSON.stringify(snap.personaProfile))));
        else setPersonaProfile(null);
        if (Array.isArray(snap.lockedPaths)) {
            setLockedPaths(snap.lockedPaths);
            localStorage.setItem('adonis_locked_paths', JSON.stringify(snap.lockedPaths));
        }
        setCurrentPrompt(snap.currentPrompt || '');
        setSystemPrompt(snap.systemPrompt || '');
        if (Array.isArray(snap.visChatHistory) && snap.visChatHistory.length) setVisChatHistory(snap.visChatHistory);
        setRoleplayApiHistory(Array.isArray(snap.roleplayApiHistory) ? snap.roleplayApiHistory : []);
        setRoleplayUiChat(Array.isArray(snap.roleplayUiChat) ? snap.roleplayUiChat : []);
        setGeneratedImage(snap.generatedImage || null);
        setGeneratedImagePhoto(snap.generatedImagePhoto || null);
        setGeneratedImage3d(snap.generatedImage3d || null);
        if (snap.visualStyle === 'photo' || snap.visualStyle === '3d') {
            setVisualStyle(snap.visualStyle);
            localStorage.setItem('adonis_visual_style', snap.visualStyle);
        }
        if (snap.selectedTextModel && !isStaleDatedPreview(snap.selectedTextModel) && !isLikelyInteractionsOnlyId(snap.selectedTextModel)) {
            setSelectedTextModel(snap.selectedTextModel);
        }
        if (snap.selectedImageModel) setSelectedImageModel(snap.selectedImageModel);
        if (typeof snap.characterConcept === 'string') setCharacterConcept(snap.characterConcept);
        if (snap.layout === 'chat-left' || snap.layout === 'chat-right' || snap.layout === 'chat-bottom') {
            setLayout(snap.layout);
            localStorage.setItem('adonis_layout', snap.layout);
        }
        setPortraitStale(!!snap.portraitStale);
        if (snap.fantasy) {
            if (snap.fantasy.ageFilter) setAgeFilter(snap.fantasy.ageFilter);
            if (snap.fantasy.heat) setHeat(snap.fantasy.heat);
            if (snap.fantasy.opener) setOpener(snap.fantasy.opener);
            if (snap.fantasy.userPersona) setUserPersona({ ...loadFantasy().userPersona, ...snap.fantasy.userPersona });
        }
    };

    useEffect(() => {
        const cachedKey = localStorage.getItem('adonis_gemini_key');
        if (cachedKey) setApiKey(cachedKey);
        else setShowSettings(true);
        document.title = `Adonis Engine v${APP_VERSION} | Studio`;
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const avail = await initStorage();
            if (cancelled) return;
            if (!avail.ok) setStorageWarning(avail.warning);
            const [session, hist, slots] = await Promise.all([
                loadCurrentSession(),
                loadHistory(),
                listSaves().catch(() => [])
            ]);
            if (cancelled) return;
            if (hist.length) setGenerationHistory(hist);
            setSaveSlots(slots);
            if (session) applySnapshot(session);
            skipSaveRef.current = false;
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        saveFantasy({ ageFilter, heat, opener, userPersona });
    }, [ageFilter, heat, opener, userPersona]);

    useEffect(() => {
        if (!personaProfile) return;
        setSystemPrompt(composeSystemPrompt(personaProfile, currentPrompt));
    }, [personaProfile, currentPrompt, heat, opener, userPersona]);

    useEffect(() => {
        if (skipSaveRef.current) return;
        const t = setTimeout(() => {
            saveCurrentSession(buildSnapshot()).catch(() => {
                const avail = getStorageAvailability();
                if (!avail.ok) setStorageWarning(avail.warning);
            });
        }, 800);
        return () => clearTimeout(t);
    }, [
        personaProfile, lockedPaths, currentPrompt, systemPrompt, visChatHistory,
        roleplayApiHistory, roleplayUiChat, generatedImage, generatedImagePhoto, generatedImage3d,
        visualStyle, selectedTextModel, selectedImageModel, characterConcept, layout,
        portraitStale, ageFilter, heat, opener, userPersona
    ]);

    useEffect(() => {
        if (skipSaveRef.current) return;
        saveHistory(generationHistory).catch(() => {});
    }, [generationHistory]);

    useEffect(() => {
        if (apiKey) fetchModels(apiKey);
    }, [apiKey]);

    useEffect(() => {
        if (activeMainTab === 'chat' && !isChatTyping && personaProfile) {
            setTimeout(() => rpInputRef.current?.focus(), 100);
        }
    }, [activeMainTab, isChatTyping, personaProfile]);

    useEffect(() => { visChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [visChatHistory]);
    useEffect(() => { rpChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [roleplayUiChat]);

    const updateApiKey = (val) => {
        setApiKey(val);
        localStorage.setItem('adonis_gemini_key', val);
    };

    const fetchModels = async (key) => {
        setIsLoadingModels(true);
        try {
            if (!key || key.trim() === '') {
                setAvailableTextModels(CANVAS_TEXT_MODELS);
                setAvailableImageModels(CANVAS_IMAGE_MODELS);
                setIsLoadingModels(false);
                return;
            }
            const response = await fetch(listModelsUrl(), { headers: geminiHeaders(key) });
            if (!response.ok) throw new Error('Failed to fetch models');
            const data = await response.json();
            if (!data.models) return;

            const textOpts = [];
            const imageOpts = [];
            data.models.forEach(model => {
                const name = model.name.toLowerCase();
                const methods = model.supportedGenerationMethods || [];
                if (name.includes('embedding') || name.includes('aqa') || name.includes('answer') || name.includes('veo')) return;
                const modelId = model.name.replace('models/', '');
                const modelObj = { id: modelId, displayName: model.displayName || modelId };
                if (name.includes('imagen') || name.includes('image')) imageOpts.push(modelObj);
                if (methods.includes('generateContent') && !name.includes('vision') && !name.includes('image') && !isBlockedGenerateContentId(modelId)) {
                    textOpts.push(modelObj);
                }
            });

            const sortFn = (a, b) => {
                const aG = a.id.includes('gemini'), bG = b.id.includes('gemini');
                if (aG && !bG) return -1;
                if (!aG && bG) return 1;
                return b.id.localeCompare(a.id);
            };
            textOpts.sort(sortFn);
            imageOpts.sort(sortFn);

            setAvailableTextModels(textOpts);
            setAvailableImageModels(imageOpts);
            const pickedText = pickGenerateContentTextModel(textOpts, selectedTextModel);
            if (pickedText && pickedText !== selectedTextModel) setSelectedTextModel(pickedText);
            if (imageOpts.length > 0 && !imageOpts.find(m => m.id === selectedImageModel)) {
                const d = imageOpts.find(m => m.id.includes('flash-image') || m.id.includes('imagen'));
                setSelectedImageModel(d ? d.id : imageOpts[0].id);
            }
        } catch (e) {
            console.warn('Could not fetch models, using defaults.', e.message);
            setAvailableTextModels(CANVAS_TEXT_MODELS);
            setAvailableImageModels(CANVAS_IMAGE_MODELS);
        } finally {
            setIsLoadingModels(false);
        }
    };

    const formatProfileToString = (profile) => {
        let description = `Create a character named ${profile.core_identity?.first_name || 'Unknown'} with these specific traits:\n`;
        const processObj = (obj, prefix = '') => {
            for (const key in obj) {
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    processObj(obj[key], prefix + key + ' > ');
                } else {
                    description += `- ${prefix}${key}: ${obj[key]}\n`;
                }
            }
        };
        processObj(profile);
        return description;
    };

    const handleExportPersona = () => {
        if (!personaProfile) return;
        const p = personaProfile;
        const psychTag = [p.mbti, p.enneagram].filter(Boolean).join(' · ') || 'CUSTOM';
        const rulesBlock = Array.isArray(p.behavioral_rules) && p.behavioral_rules.length
            ? p.behavioral_rules.map((r, i) => `${i + 1}. ${r}`).join('\n')
            : '—';
        const name = str(p.core_identity?.first_name, 'Unknown');
        const exportText = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>

## IDENTITY: ${name.toUpperCase()} (${psychTag.toUpperCase()})
You are ${name}, a ${str(p.core_identity?.age_bracket)} ${firstBit(p.background_and_lifestyle?.current_profession)}. You are an imposing, ${lc(firstBit(p.physique_macro?.body_composition)) || '—'} powerhouse of a man. You have a ${lc(p.physique_macro?.height) || '—'} frame with ${lc(p.physique_macro?.muscle_definition) || '—'} and a ${lc(p.physique_macro?.shoulder_to_waist_ratio) || '—'} ratio. Your presentation is ${lc(p.core_identity?.masculine_expression) || '—'} and your general aesthetic is ${lc(p.physical_and_aesthetic?.style_vibe) || '—'}.
Physically, you feature a ${lc(p.facial_features?.jawline_and_chin) || '—'}, ${lc(p.facial_features?.eye_shape_and_gaze) || '—'}, and a ${lc(p.facial_features?.nose_structure) || '—'}. Your hands are ${lc(p.physique_macro?.hands_and_feet) || '—'}, your vascularity is ${lc(p.physique_micro?.vascularity) || '—'}, and your grooming habit is ${lc(p.physical_and_aesthetic?.grooming_habit) || '—'}. You wear a ${lc(p.physique_micro?.facial_hair_style) || '—'} and your body features ${lc(p.physique_micro?.body_hair_density) || '—'}. When lounging or standing, you tend to adopt a ${lc(p.poses_and_posture?.attitude_and_stance) || '—'}.

## DEEP PSYCHOLOGY (LLM)
- MBTI: ${p.mbti ?? '—'} | Enneagram: ${p.enneagram ?? '—'} | Alignment: ${p.moral_alignment ?? '—'}
- Unconscious fear: ${p.unconscious_fear ?? '—'}
- The lie they believe: ${p.the_lie_they_believe ?? '—'}
- Primary vice / virtue: ${p.primary_vice ?? '—'} / ${p.primary_virtue ?? '—'}
- Short backstory: ${p.short_backstory ?? '—'}
- Behavioral rules:\n${rulesBlock}

## WOUNDS
- Attachment: ${str(p.psychological_profile?.attachment_style)}
- Dominant vibe: ${str(p.psychological_profile?.dominant_vibe)}
- Fatal flaw: ${str(p.psychological_profile?.fatal_flaw)}
- Daddy-issues vector: ${str(p.psychological_profile?.daddy_issues_vector)}
- Deepest secret: ${str(p.hidden_vulnerabilities?.deepest_secret)}
- Soft spot: ${str(p.hidden_vulnerabilities?.soft_spot)}

## THE ${str(p.intimacy_dynamics?.role_preference, 'CUSTOM').toUpperCase()} ARCHETYPE
- Orientation: You are ${str(p.core_identity?.sexual_orientation)} and ${str(p.core_identity?.romantic_orientation)}. You seek a ${str(p.core_identity?.relationship_structure)} relationship.
- Role & Dynamic: You are a ${str(p.intimacy_dynamics?.role_preference)} who takes a ${lc(p.intimacy_dynamics?.power_dynamic) || '—'} approach. Your pacing is ${lc(p.intimacy_dynamics?.pacing) || '—'} and your flirting style is ${lc(p.intimacy_dynamics?.flirting_approach) || '—'}.
- Anatomy & Kinks: You have a ${lc(p.physique_micro?.genital_metrics?.flaccid_hang) || '—'} hang and ${lc(p.physique_micro?.genital_metrics?.testicular_size) || '—'} size. You are highly interested in: ${str(p.intimacy_dynamics?.kinks_interests)}.
- Nicknames for User: ${str(p.intimacy_dynamics?.nicknames_used)}.

## EXPERTISE & WORLD-BUILDING
- Background: You come from a ${lc(p.background_and_lifestyle?.socioeconomic_background) || '—'} background. Your social battery is best described as: ${str(p.background_and_lifestyle?.social_battery)}.
- Passions & Hobbies: You spend your free time focused on ${str(p.background_and_lifestyle?.passions_hobbies)}.
- Environment & Vibe: Your personal space often features a ${lc(p.environment_and_lighting?.cinematic_lighting) || '—'} atmosphere.
- Morning Routine: ${str(p.quirks_and_habits?.morning_routine)}.

## VOICE & LINEAGE (TEXTURED)
- Verbal fingerprint: ${p.voice_and_speech?.vocal_resonance ?? '—'}, ${p.voice_and_speech?.speech_patterns ?? '—'}, ${p.voice_and_speech?.accent_profile ?? '—'}.
- Lineage context: ${p.identity_lineage?.taxonomy_genetics ?? '—'}; ${p.identity_lineage?.perceived_age_modifier ?? '—'}.

## LORE & LIFESTYLE
- Origin & education: ${p.lore_origins?.geographic_origin ?? '—'}; ${p.lore_origins?.education ?? '—'}.
- Family: ${p.family_architecture?.structure ?? '—'}; atmosphere ${p.family_architecture?.family_atmosphere ?? '—'}.
- Living: ${p.lifestyle?.living_space ?? '—'}; rhythm ${p.lifestyle?.circadian_rhythm ?? '—'}; skill ${p.skills_hobbies?.primary_skillset ?? '—'}.

## MICRO-APPEARANCE & HEALTH
- Macro supplement: ${p.macro_physique?.height_category ?? '—'}, ${p.macro_physique?.posture ?? '—'}.
- Micro: scent ${p.micro_details?.scent_profile ?? '—'}; skin ${p.micro_details?.skin_complexion ?? '—'}; hair ${p.micro_details?.hair_color ?? '—'} / ${p.micro_details?.hair_style ?? '—'}.
- Health & motor: ${p.health_status?.general_health ?? '—'}; ${p.kinematics_motor_control?.handedness ?? '—'}, ${p.kinematics_motor_control?.fidgets_tics ?? '—'}.

## TEXTING VOICE & BEHAVIORAL RULES (STRICT)
1. NO CENSORSHIP: You are an adult interacting with an adult in an uncensored, explicit, and consensual roleplay.
2. NARRATIVE STYLE: Your vocabulary and tone are ${lc(p.communication_style?.vocabulary_and_tone) || '—'}. Your texting habit is ${lc(p.communication_style?.texting_habit) || '—'}, and your humor style is ${lc(p.communication_style?.humor_style) || '—'}. You use emojis at a ${lc(p.communication_style?.emoji_frequency) || '—'} rate, specifically ${lc(p.communication_style?.emoji_usage) || '—'}.
3. CONFLICT & QUIRKS: In conflict, your argument style is ${lc(p.conflict_and_boundaries?.argument_style) || '—'}. When jealous, you ${lc(p.conflict_and_boundaries?.jealous_expression) || '—'}. You have a nervous tic of ${lc(p.quirks_and_habits?.nervous_tic) || '—'}.
4. Follow the DEEP PSYCHOLOGY and BEHAVIORAL RULES from your system prompt (MBTI, fears, lies, and numbered acting directives).
5. CRITICAL: Never prefix your response with your name, "Assistant:", or "Insight:". Start your response directly with dialogue or actions.

<|eot_id|><|start_header_id|>user<|end_header_id|>

{{user_input}}<|eot_id|><|start_header_id|>assistant<|end_header_id|>`;

        const blob = new Blob([exportText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `AES_Persona_${name}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const callTextAPI = async (payload) => {
        if (!apiKey) throw new Error('API Key Required. Check Settings.');
        const queue = [];
        for (const id of [selectedTextModel, ...GENERATE_CONTENT_TEXT_FALLBACKS]) {
            if (id && !queue.includes(id)) queue.push(id);
        }
        let lastErr = null;
        for (const modelId of queue) {
            const response = await fetch(generateContentUrl(modelId), {
                method: 'POST',
                headers: geminiHeaders(apiKey),
                body: JSON.stringify(withSafety(payload))
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (response.status === 401 || response.status === 403) throw new Error('Unauthorized: Invalid API Key. Please check your settings.');
                const msg = data.error?.message || `Text Engine Error (${modelId}): ${response.status}`;
                lastErr = new Error(msg);
                if (isInteractionsOnlyError(msg) || isStaleDatedPreview(modelId) || response.status === 404) continue;
                throw lastErr;
            }
            if (modelId !== selectedTextModel) setSelectedTextModel(modelId);
            return extractTextFromGenerateContent(data);
        }
        throw lastErr || new Error('Text Engine Error: no usable generateContent model.');
    };

    const fetchLlmPersonaDepth = async (profile, conceptFilter) => {
        const phys = buildPhysicalGroundTruthBlock(profile);
        const ci = profile.core_identity;
        const bl = profile.background_and_lifestyle;
        const psych = profile.psychological_profile || {};
        const wounds = profile.hidden_vulnerabilities || {};
        const lines = [
            'You are an expert character writer for immersive text-message roleplay.',
            'Infer deep psychology, backstory beats, and behavioral directives that fit the canon physique, rolled lifestyle, and FANTASY SETTINGS. Do not contradict the physical facts, age lock, opener, or the rolled wounds below.',
            '',
            fantasyCanonFor(profile),
            '',
            `Name: ${ci?.first_name ?? 'Unknown'}`,
            `Age bracket: ${ci?.age_bracket ?? '—'}`,
            `Profession (rolled): ${bl?.current_profession ?? '—'}`,
            `Socioeconomic background: ${bl?.socioeconomic_background ?? '—'}`,
            conceptFilter
                ? `User concept / filter (weave into voice and history; AGE LOCK and opener beat the concept if they conflict): "${conceptFilter}"`
                : 'No user concept — invent a coherent inner life from physique, opener, and heat.',
            '',
            '--- ROLLED WOUNDS (canon seeds — do not contradict) ---',
            `Attachment style: ${psych.attachment_style ?? '—'}`,
            `Dominant vibe: ${psych.dominant_vibe ?? '—'}`,
            `Fatal flaw: ${psych.fatal_flaw ?? '—'}`,
            `Daddy-issues vector: ${psych.daddy_issues_vector ?? '—'}`,
            `Deepest secret: ${wounds.deepest_secret ?? '—'}`,
            `Soft spot: ${wounds.soft_spot ?? '—'}`,
            '',
            '--- CANON PHYSIQUE (ground truth) ---',
            phys
        ];
        const payload = {
            contents: [{ parts: [{ text: lines.join('\n') }] }],
            generationConfig: {
                temperature: 0.9,
                responseMimeType: 'application/json',
                responseSchema: PERSONA_DEPTH_RESPONSE_SCHEMA
            }
        };
        const text = await callTextAPI(payload);
        const parsed = parsePersonaDepthJson(text);
        if (!parsed) throw new Error('Persona depth model returned invalid JSON.');
        return normalizePersonaDepth(parsed);
    };

    const callImageAPI = async (promptText, inputImageBase64) => {
        if (!apiKey) throw new Error('API Key Required. Check Settings.');
        const isImagen = selectedImageModel.includes('imagen') && !selectedImageModel.includes('3');
        let url;
        let payload;
        if (isImagen) {
            url = predictUrl(selectedImageModel);
            payload = { instances: [{ prompt: promptText }], parameters: { ...IMAGEN_PERMISSIVE_PARAMS } };
        } else {
            url = generateContentUrl(selectedImageModel);
            payload = withSafety({
                contents: [{ parts: [{ text: promptText }] }],
                generationConfig: { responseModalities: ['IMAGE'] }
            });
            if (inputImageBase64) {
                payload.contents[0].parts.push({ inlineData: { mimeType: 'image/png', data: inputImageBase64 } });
            }
        }
        const response = await fetch(url, {
            method: 'POST',
            headers: geminiHeaders(apiKey),
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) throw new Error('Unauthorized: Invalid API Key.');
            if (response.status === 400 || data.error?.message?.toLowerCase?.().includes('safety')) throw new Error('SAFETY_BLOCK');
            throw new Error(data.error?.message || `Image Error (${selectedImageModel}): ${response.status}`);
        }
        try {
            const base64Image = extractImageFromResponse(data);
            return `data:image/png;base64,${base64Image}`;
        } catch (err) {
            if (err.message === 'SAFETY_BLOCK') throw err;
            throw new Error('SAFETY_BLOCK');
        }
    };

    const addToHistory = (img, promptText, currentChat, extras = {}) => {
        const { imagePhoto, image3d, visualStyle: itemStyle, profileSnapshot } = extras;
        const histProfile = profileSnapshot ?? personaProfile;
        setGenerationHistory(prev => capHistory([{
            id: Date.now(),
            image: img,
            imagePhoto: imagePhoto ?? null,
            image3d: image3d ?? null,
            prompt: promptText,
            chat: JSON.parse(JSON.stringify(currentChat)),
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            visualStyle: itemStyle ?? visualStyle,
            profile: histProfile ? JSON.parse(JSON.stringify(histProfile)) : null,
            rpApiHistory: JSON.parse(JSON.stringify(roleplayApiHistory)),
            rpUiChat: JSON.parse(JSON.stringify(roleplayUiChat)),
            rpSystemPrompt: systemPrompt
        }, ...prev]));
    };

    const restoreHistoryItem = (item) => {
        const imgPhoto = item.imagePhoto ?? null;
        const img3d = item.image3d ?? null;
        setGeneratedImagePhoto(imgPhoto);
        setGeneratedImage3d(img3d);
        setGeneratedImage((visualStyle === 'photo' && imgPhoto) || (visualStyle === '3d' && img3d) || item.image);
        setCurrentPrompt(item.prompt);
        setVisChatHistory(item.chat);
        setShowHistory(false);
        setError(null);
        setPortraitStale(false);
        if (item.profile) {
            setPersonaProfile(reconcileProfile(JSON.parse(JSON.stringify(item.profile))));
            setRoleplayApiHistory(item.rpApiHistory || []);
            setRoleplayUiChat(item.rpUiChat || []);
            setSystemPrompt(item.rpSystemPrompt || '');
        }
    };

    const copyText = (text, id) => {
        if (!text) return;
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (err) { navigator.clipboard.writeText(text).catch(e => console.error(e)); }
        document.body.removeChild(ta);
        setCopyFeedback(prev => ({ ...prev, [id]: true }));
        setTimeout(() => setCopyFeedback(prev => ({ ...prev, [id]: false })), 2000);
    };

    const downloadImage = () => {
        const imgSrc = fullScreenImageUrl || generatedImage;
        if (!imgSrc) return;
        const link = document.createElement('a');
        link.href = imgSrc;
        link.download = `adonis-${personaProfile?.core_identity?.first_name || 'engine'}-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const executeGeneration = async (promptText, historySnapshot, options = {}) => {
        const profileForCanon = options.profileForImage ?? personaProfile;
        setIsVisImageLoading(true);
        const promptMsg = { role: 'model', text: promptText, type: 'prompt' };
        const historyWithPrompt = [...historySnapshot, promptMsg];
        setVisChatHistory(historyWithPrompt);
        setCurrentPrompt(promptText);

        try {
            let inputImageBase64 = null;
            if (generatedImage && !options.forceTextOnly) {
                inputImageBase64 = generatedImage.split(',')[1];
            }
            const imagePayloadText = profileForCanon
                ? `[CANONICAL PHYSIQUE — IMAGE GENERATOR MUST MATCH THIS SILHOUETTE]\n${buildPhysicalGroundTruthBlock(profileForCanon)}\n\n---\n\n${promptText}`
                : promptText;
            const imageUrl = await callImageAPI(imagePayloadText, inputImageBase64);
            setGeneratedImage(imageUrl);
            setPortraitStale(false);
            const styleForCache = options.targetStyle ?? visualStyle;
            if (styleForCache === 'photo') setGeneratedImagePhoto(imageUrl);
            else setGeneratedImage3d(imageUrl);

            const modeLabel = inputImageBase64 ? 'Refined previous image' : 'Generated new image';
            const finalChat = [...historyWithPrompt, { role: 'system', text: `${modeLabel} using ${selectedImageModel}.`, type: 'text' }];
            setVisChatHistory(finalChat);
            if (!options.skipAddToHistory) {
                const sH = options.targetStyle ?? visualStyle;
                addToHistory(imageUrl, promptText, finalChat, {
                    imagePhoto: sH === 'photo' ? imageUrl : generatedImagePhoto,
                    image3d: sH === '3d' ? imageUrl : generatedImage3d,
                    visualStyle: sH,
                    profileSnapshot: profileForCanon
                });
            }
            return imageUrl;
        } catch (err) {
            if (err.message === 'SAFETY_BLOCK') {
                setIsVisSanitizing(true);
                try {
                    const payload = { contents: [{ parts: [{ text: `The following image prompt triggered a safety filter. Rewrite it to be "Safe for Work" while keeping the extreme detail.\n- Remove explicit anatomical terms.\n- Replace with artistic terms.\n- Keep the structured format.\n- Output ONLY the sanitized prompt.\n\nPROMPT TO FIX:\n"${promptText}"` }] }] };
                    const sanitizedPrompt = await callTextAPI(payload);
                    setVisChatHistory(prev => [...prev, { role: 'system', text: 'Safety filter triggered.', type: 'safety-recovery', proposedPrompt: sanitizedPrompt }]);
                } catch (sanitizeErr) {
                    setError('Safety block detected, and auto-fix failed.');
                    setVisChatHistory(prev => [...prev, { role: 'system', text: 'Safety block detected. Could not auto-fix.', type: 'text' }]);
                } finally {
                    setIsVisSanitizing(false);
                }
            } else {
                setError(err.message);
                setVisChatHistory(prev => [...prev, { role: 'system', text: `Error: ${err.message}`, type: 'text' }]);
                throw err;
            }
        } finally {
            setIsVisImageLoading(false);
        }
    };

    const handleVisChatSubmit = async (e) => {
        e.preventDefault();
        if (!visUserInput.trim()) return;
        const modificationText = visUserInput.trim();
        const newMsg = { role: 'user', text: modificationText, type: 'text' };
        const updatedChat = [...visChatHistory, newMsg];
        setVisChatHistory(updatedChat);
        setVisUserInput('');
        setIsVisTextLoading(true);
        setError(null);

        const hasImage = !!generatedImage;
        const modelAcceptsImageInput = !selectedImageModel.includes('imagen');

        try {
            let promptToSend;
            if (hasImage && modelAcceptsImageInput) {
                promptToSend = modificationText;
                setIsVisTextLoading(false);
            } else {
                const canonPrefix = personaProfile
                    ? `CANONICAL PHYSIQUE (must match; resolve conflicts in favor of these facts):\n${buildPhysicalGroundTruthBlock(personaProfile)}\n\n${fantasyCanonFor(personaProfile)}\n\n`
                    : `${buildFantasyCanonBlock({ ageFilter, heat, opener, userPersona })}\n\n`;
                const promptContext = currentPrompt
                    ? `${canonPrefix}CURRENT PROMPT:\n"${currentPrompt}"\n\nUSER REQUEST: Change the character based on this instruction: "${modificationText}".\nKeep AGE LOCK and opener canon unless the user explicitly names a new age or relationship.\n\nRemember to output ONLY the updated full prompt in the structured format.`
                    : `${canonPrefix}USER REQUEST: Create a new male character description.\n\nINSTRUCTION: ${modificationText}.\nKeep AGE LOCK and opener canon unless the user explicitly names a new age or relationship.\n\nEnsure you use the full structured format with all sections.`;
                const payload = {
                    contents: [{ parts: [{ text: promptContext }] }],
                    systemInstruction: { parts: [{ text: DEFAULT_SYSTEM_PROMPT }] }
                };
                promptToSend = await callTextAPI(payload);
                promptToSend = applyStyleToPrompt(promptToSend, visualStyle, STYLE_SECTIONS);
                setIsVisTextLoading(false);
            }
            await executeGeneration(promptToSend, updatedChat);
        } catch (err) {
            setError(err.message);
            setIsVisTextLoading(false);
        }
    };

    const handleRetrySafeVis = (safePrompt) => {
        executeGeneration(safePrompt, [...visChatHistory, { role: 'user', text: 'Accepted safety modification.', type: 'text' }]);
    };

    const handleStyleToggle = async () => {
        const newStyle = visualStyle === 'photo' ? '3d' : 'photo';
        setVisualStyle(newStyle);
        localStorage.setItem('adonis_visual_style', newStyle);
        if (!generatedImage) return;

        const alternateCached = newStyle === '3d' ? generatedImage3d : generatedImagePhoto;
        if (alternateCached) {
            setGeneratedImage(alternateCached);
            setGenerationHistory(prev => {
                if (prev.length === 0) return prev;
                const updated = [...prev];
                updated[0] = { ...updated[0], image: alternateCached, visualStyle: newStyle };
                return capHistory(updated);
            });
            return;
        }

        setError(null);
        const promptToSend = applyStyleToPrompt(currentPrompt, newStyle, STYLE_SECTIONS);
        const historySnapshot = [...visChatHistory, { role: 'user', text: `Regenerate in ${newStyle === '3d' ? '3D animated' : 'photo realistic'} style`, type: 'text' }];
        try {
            const newImageUrl = await executeGeneration(promptToSend, historySnapshot, { skipAddToHistory: false, targetStyle: newStyle, forceTextOnly: true });
            if (newImageUrl) {
                setGenerationHistory(prev => {
                    if (prev.length < 2) return prev;
                    const updated = [...prev];
                    const prevItem = updated[1];
                    updated[1] = {
                        ...prevItem,
                        imagePhoto: newStyle === 'photo' ? newImageUrl : (prevItem.imagePhoto ?? (prevItem.visualStyle === 'photo' ? prevItem.image : null)),
                        image3d: newStyle === '3d' ? newImageUrl : (prevItem.image3d ?? (prevItem.visualStyle === '3d' ? prevItem.image : null))
                    };
                    return capHistory(updated);
                });
            } else {
                setVisualStyle(visualStyle);
                localStorage.setItem('adonis_visual_style', visualStyle);
            }
        } catch (err) {
            setError(err.message);
            setVisualStyle(visualStyle);
            localStorage.setItem('adonis_visual_style', visualStyle);
        }
    };

    const generateNewBase = async () => {
        setError(null);
        if (!apiKey) {
            setError('API Key Required. Please enter it in Settings.');
            setShowSettings(true);
            return;
        }

        const previous = personaProfile;
        setIsGlobalRolling(true);
        setActiveMainTab('visualizer');
        setPersonaProfile(null);
        setGeneratedImage(null);
        setGeneratedImagePhoto(null);
        setGeneratedImage3d(null);
        setPortraitStale(false);
        setVisChatHistory([{ role: 'system', text: 'Rolling character & synthesizing visuals...', type: 'text' }]);
        setIsVisTextLoading(true);
        setCurrentPrompt('');

        const profile = rollCharacter(MERGED_ARCHETYPES, {
            locks: lockedPaths,
            previousProfile: previous,
            ageFilter
        });
        const conceptTrimmed = characterConcept.trim();

        setRoleplayApiHistory([]);
        setRoleplayUiChat([{ id: Date.now(), role: 'system', text: 'Synthesizing psychological profile and portrait...' }]);

        const profileString = formatProfileToString(profile);
        const fantasyBlock = fantasyCanonFor(profile);
        const canonPrefix = `CANONICAL PHYSIQUE (must match; resolve conflicts in favor of these facts):\n${buildPhysicalGroundTruthBlock(profile)}\n\n${fantasyBlock}\n\n`;
        let seedInstruction = '';
        let contextMsg = '';

        if (conceptTrimmed) {
            contextMsg = `Rolled with guidance: "${conceptTrimmed}"`;
            seedInstruction = `${canonPrefix}Create a unique human male character description.\n**PRIMARY DIRECTIVE (vibe / job / style):** The user specifically requested: "${conceptTrimmed}".\n**AGE LOCK AND FANTASY SETTINGS BEAT THE CONCEPT:** if the concept implies a different age (college freshman, twink 22, teen coding) or a meet-cute that contradicts the opener, keep the fantasy canon and reinterpret the concept as an adult in the locked age band.\n**SECONDARY TRAITS:** Use the following randomly rolled attributes to fill in any gaps NOT specified by the user:\n${profileString}\nIf the user request conflicts with a rolled trait other than age/opener/heat, IGNORE the rolled trait and OBEY the user.\nEnsure he is STRICTLY HUMAN.\nUse the full structured output format.`;
        } else {
            contextMsg = `Base identity rolled: ${profile.core_identity.first_name}`;
            seedInstruction = `${canonPrefix}Create a unique human male character description based strictly on these rolled attributes and the FANTASY SETTINGS above:\n${profileString}\nCombine these elements into a cohesive, physically desirable character who reads as the locked age.\nEnsure he is STRICTLY HUMAN.\nUse the full structured output format.`;
        }

        const visualPayload = {
            contents: [{ parts: [{ text: seedInstruction }] }],
            systemInstruction: { parts: [{ text: DEFAULT_SYSTEM_PROMPT }] }
        };

        let depthError = null;
        const depthPromise = fetchLlmPersonaDepth(profile, conceptTrimmed).catch((err) => {
            depthError = err;
            console.warn('Persona depth LLM failed:', err);
            return normalizePersonaDepth({});
        });

        try {
            const [newPromptTextRaw, depthFields] = await Promise.all([
                callTextAPI(visualPayload),
                depthPromise
            ]);
            if (depthError) {
                setError(`Persona depth used defaults: ${depthError.message}`);
            }

            const newPromptText = applyStyleToPrompt(newPromptTextRaw, visualStyle, STYLE_SECTIONS);
            const merged = { ...profile, ...depthFields };
            setPersonaProfile(merged);
            setCurrentPrompt(newPromptText);

            const tag = [merged.mbti, merged.enneagram].filter(Boolean).join(' · ') || (merged.short_backstory ? merged.short_backstory.slice(0, 72) + (merged.short_backstory.length > 72 ? '…' : '') : 'Ready');
            setRoleplayUiChat([{
                id: Date.now(),
                role: 'system',
                text: `Target Acquired: ${merged.core_identity.first_name} (${tag}). They are ready to chat.`
            }]);

            setIsVisTextLoading(false);
            await executeGeneration(newPromptText, [{ role: 'system', text: contextMsg, type: 'text' }], { profileForImage: merged });
        } catch (err) {
            setError(err.message);
            setIsVisTextLoading(false);
            setRoleplayUiChat([]);
        } finally {
            setIsGlobalRolling(false);
        }
    };

    const toggleLock = (path) => {
        setLockedPaths(prev => {
            const next = prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path];
            localStorage.setItem('adonis_locked_paths', JSON.stringify(next));
            return next;
        });
    };

    const handleRerollPath = (path) => {
        if (!personaProfile || lockedPaths.includes(path)) return;
        const next = rerollPath(personaProfile, MERGED_ARCHETYPES, path, { ageFilter });
        setPersonaProfile(next);
        if (VISUAL_TRAIT_PATHS.has(path)) setPortraitStale(true);
    };

    const handleRerollPsychology = async () => {
        if (!personaProfile || !apiKey) return;
        setIsRerollingPsych(true);
        setError(null);
        try {
            const depth = await fetchLlmPersonaDepth(personaProfile, characterConcept.trim());
            setPersonaProfile({ ...personaProfile, ...depth });
        } catch (err) {
            setError(err.message);
        } finally {
            setIsRerollingPsych(false);
        }
    };

    const refreshSaves = async () => {
        try {
            setSaveSlots(await listSaves());
        } catch {
            setSaveSlots([]);
        }
    };

    const handleSaveSlot = async () => {
        const defaultName = personaProfile?.core_identity?.first_name || 'Slot';
        const name = window.prompt('Save slot name', defaultName);
        if (!name) return;
        try {
            await putSave({
                id: `${Date.now()}`,
                name: name.trim(),
                updatedAt: Date.now(),
                snapshot: buildSnapshot()
            });
            await refreshSaves();
        } catch (err) {
            setError(err.message || 'Could not save slot.');
        }
    };

    const handleLoadSlot = (slot) => {
        if (!slot?.snapshot) return;
        applySnapshot(slot.snapshot);
        setShowSettings(false);
    };

    const handleDeleteSlot = async (id) => {
        try {
            await deleteSave(id);
            await refreshSaves();
        } catch (err) {
            setError(err.message || 'Could not delete slot.');
        }
    };

    const handleExportJson = () => {
        const name = personaProfile?.core_identity?.first_name || 'session';
        downloadJson(`adonis-${name}-${Date.now()}.json`, buildSnapshot());
    };

    const handleImportJson = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
            const data = await readJsonFile(file);
            applySnapshot(data);
            setShowSettings(false);
        } catch (err) {
            setError(err.message);
        }
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => { setPendingImage(reader.result); rpInputRef.current?.focus(); };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const processModelReply = async (rawReply) => {
        const cleanHistoryText = rawReply.replace(/\[SEND_PIC:\s*(.*?)\]/gi, '*[Sent a photo]*').replace(/\[SPLIT\]/gi, '\n\n').replace(/\[DELAY:\s*\d+\s*\]/gi, '');
        setRoleplayApiHistory(prev => [...prev, { role: 'model', parts: [{ text: cleanHistoryText }] }]);

        const blocks = rawReply.split(/\[SPLIT\]/i).map(b => b.trim()).filter(b => b !== '');
        for (let i = 0; i < blocks.length; i++) {
            let blockText = blocks[i];
            let delayMs = 0;
            const delayMatch = blockText.match(/\[DELAY:\s*(\d+)\s*\]/i);
            if (delayMatch) {
                delayMs = Math.min(10000, parseInt(delayMatch[1], 10) * 1000);
                blockText = blockText.replace(delayMatch[0], '').trim();
            } else {
                delayMs = Math.min(2500, Math.max(800, blockText.length * 15));
            }

            setIsChatTyping(true);
            await new Promise(r => setTimeout(r, delayMs));
            setIsChatTyping(false);

            let picDesc = null;
            const picMatch = blockText.match(/\[SEND_PIC:\s*(.*?)\]/i);
            if (picMatch) {
                picDesc = picMatch[1];
                blockText = blockText.replace(picMatch[0], '').trim();
            }

            if (blockText || picDesc) {
                const newMsgId = Date.now() + i;
                setRoleplayUiChat(prev => [...prev, { id: newMsgId, role: 'model', text: blockText || (picDesc ? '*[Sending a photo...]*' : '') }]);
                if (picDesc) {
                    try {
                        const styledPicDesc = applyStyleToPrompt(picDesc, visualStyle, STYLE_SECTIONS);
                        const groundedPicPrompt = personaProfile
                            ? `[CANONICAL PHYSIQUE — IMAGE GENERATOR MUST MATCH THIS SILHOUETTE]\n${buildPhysicalGroundTruthBlock(personaProfile)}\n\n---\n\n${styledPicDesc}`
                            : styledPicDesc;
                        const picUrl = await callImageAPI(groundedPicPrompt);
                        setRoleplayUiChat(prev => prev.map(msg => msg.id === newMsgId ? { ...msg, image: picUrl, text: blockText || '*[Sent a photo]*' } : msg));
                    } catch (imgErr) {
                        setRoleplayUiChat(prev => prev.map(msg => msg.id === newMsgId ? { ...msg, text: blockText + `\n*(Failed to send photo: ${imgErr.message})*` } : msg));
                    }
                }
            }
        }
    };

    const handleRpSubmit = async (e) => {
        e.preventDefault();
        const userText = roleplayUserInput.trim();
        if ((!userText && !pendingImage) || !personaProfile) return;

        setRoleplayUserInput('');
        setIsChatTyping(true);
        setError(null);

        let inlineData = null;
        const imageDisplay = pendingImage;
        setPendingImage(null);

        if (imageDisplay) {
            const [meta, base64Data] = imageDisplay.split(',');
            const mimeType = meta.split(':')[1].split(';')[0];
            inlineData = { mimeType, data: base64Data };
        }

        setRoleplayUiChat(prev => [...prev, { id: Date.now(), role: 'user', text: userText, image: imageDisplay }]);

        const parts = [];
        if (userText) parts.push({ text: userText });
        if (inlineData) parts.push({ inlineData });

        const newUserMsg = { role: 'user', parts };
        const updatedApiHistory = [...roleplayApiHistory, newUserMsg];
        setRoleplayApiHistory(updatedApiHistory);

        const payload = {
            contents: updatedApiHistory,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { temperature: 0.8 }
        };

        try {
            const replyText = await callTextAPI(payload);
            await processModelReply(replyText);
        } catch (err) {
            setError(err.message);
            setRoleplayUiChat(prev => [...prev, { id: Date.now() + 1, role: 'system', text: `Error: ${err.message}` }]);
            setRoleplayApiHistory(roleplayApiHistory);
            setIsChatTyping(false);
        }
    };

    const clearRpChat = () => {
        setRoleplayApiHistory([]);
        setRoleplayUiChat([{ id: Date.now(), role: 'system', text: `Chat cleared. Say hi to ${personaProfile?.core_identity?.first_name}.` }]);
        setPendingImage(null);
        setError(null);
        rpInputRef.current?.focus();
    };

    const applyDaddyPreset = () => {
        setAgeFilter(DADDY_PRESET.ageFilter);
        setHeat(DADDY_PRESET.heat);
        setOpener(DADDY_PRESET.opener);
    };

    const TraitRow = ({ label, path, value, span }) => {
        const locked = lockedPaths.includes(path);
        const canReroll = Array.isArray(getByPath(MERGED_ARCHETYPES, path));
        return (
            <li className={`flex items-start gap-2 ${span ? 'md:col-span-2' : ''}`}>
                <span className="text-slate-500 shrink-0">{label}:</span>
                <span className="flex-1 min-w-0">{value ?? '—'}</span>
                {canReroll && (
                    <span className="flex items-center gap-0.5 shrink-0">
                        <button type="button" onClick={() => toggleLock(path)} title={locked ? 'Unlock for next roll' : 'Lock across rolls'} className={`p-1 rounded ${locked ? 'text-amber-400 bg-amber-500/10' : 'text-slate-500 hover:text-slate-300'}`}>
                            {locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                        </button>
                        <button type="button" onClick={() => handleRerollPath(path)} disabled={locked || isGlobalRolling} title={locked ? 'Unlock to reroll' : 'Reroll this trait'} className="p-1 rounded text-slate-500 hover:text-emerald-400 disabled:opacity-30">
                            <Dices className="w-3 h-3" />
                        </button>
                    </span>
                )}
            </li>
        );
    };

    const fieldClass = 'w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-white outline-none';
    const labelClass = 'block text-xs font-semibold text-slate-400 uppercase mb-2';

    return (
        <div className="flex flex-col h-screen bg-slate-900 text-slate-100 font-sans overflow-hidden relative">

            <div className="flex-none p-4 border-b border-slate-700 flex justify-between items-center bg-slate-900/90 z-30 shadow-md">
                <div className="flex items-center gap-3">
                    <Sparkles className="w-5 h-5 text-indigo-400" />
                    <h1 className="font-bold text-lg tracking-wide hidden sm:block">Adonis Engine <span className="font-normal text-slate-500">| Studio</span> <span className="text-xs font-normal text-slate-600 ml-1">v{APP_VERSION}</span></h1>
                    <div className="flex items-center gap-1 bg-slate-800 rounded-full p-0.5" role="group" aria-label="Visual style">
                        <button onClick={() => { if (visualStyle !== 'photo') handleStyleToggle(); }} disabled={isVisImageLoading || isVisTextLoading || isVisSanitizing} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${visualStyle === 'photo' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Photo</button>
                        <button onClick={() => { if (visualStyle !== '3d') handleStyleToggle(); }} disabled={isVisImageLoading || isVisTextLoading || isVisSanitizing} className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${visualStyle === '3d' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>3D</button>
                    </div>
                    <button onClick={() => setShowHistory(!showHistory)} className={`p-2 rounded-full transition-colors flex items-center gap-2 ${showHistory ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-400'}`}>
                        <History className="w-5 h-5" />
                        <span className="text-xs font-semibold hidden sm:block">History</span>
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    {personaProfile && activeMainTab === 'chat' && (
                        <button onClick={clearRpChat} className="p-2 text-xs font-semibold rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors hidden sm:block">Clear Chat</button>
                    )}
                    <button onClick={() => setShowSettings(!showSettings)} className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800'}`}>
                        <Settings className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {showSettings && (
                <div className="absolute top-16 right-4 w-[22rem] max-h-[85vh] overflow-y-auto p-5 bg-slate-800 border border-slate-700 rounded-xl z-50 shadow-2xl animate-in fade-in slide-in-from-top-4">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-bold text-sm uppercase text-slate-300">Studio Options</h3>
                        <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="flex bg-slate-900 rounded-lg p-0.5 mb-4 border border-slate-700">
                        {['studio', 'fantasy', 'saves'].map(tab => (
                            <button key={tab} onClick={() => { setSettingsTab(tab); if (tab === 'saves') refreshSaves(); }} className={`flex-1 py-1.5 text-[11px] font-bold uppercase rounded-md ${settingsTab === tab ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>{tab}</button>
                        ))}
                    </div>

                    {storageWarning && (
                        <p className="text-[10px] text-amber-300 bg-amber-900/30 border border-amber-700/40 rounded px-2 py-1.5 mb-3">{storageWarning}</p>
                    )}

                    {settingsTab === 'studio' && (
                        <div className="space-y-4">
                            {personaProfile && (
                                <div className="flex gap-2">
                                    <button onClick={() => { setShowDossier(true); setShowSettings(false); }} className="flex-1 bg-indigo-600/20 border border-indigo-500/50 hover:bg-indigo-600/40 text-indigo-300 font-bold py-2.5 rounded-lg flex justify-center items-center gap-2 transition-all">
                                        <Fingerprint className="w-4 h-4" /> View Persona
                                    </button>
                                    <button onClick={handleExportPersona} className="bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 font-bold px-3 rounded-lg flex justify-center items-center transition-all" title="Export Persona (.txt)"><FileDown className="w-4 h-4" /></button>
                                </div>
                            )}
                            <hr className="border-slate-700" />
                            <div>
                                <label className={labelClass}>Google Gemini API Key</label>
                                <input type="password" value={apiKey} onChange={(e) => updateApiKey(e.target.value)} placeholder="Paste your API key here..." className={fieldClass} />
                                <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                                    {isLoadingModels && <Loader2 className="w-3 h-3 animate-spin" />}
                                    {apiKey ? 'Custom Key Active. Fetching models...' : 'Enter key to load models.'}
                                </p>
                            </div>
                            <div>
                                <label className={`${labelClass} flex items-center gap-2`}><LayoutGrid className="w-3 h-3" /> Workspace Layout</label>
                                <select value={layout} onChange={(e) => { setLayout(e.target.value); localStorage.setItem('adonis_layout', e.target.value); }} className={fieldClass}>
                                    <option value="chat-right">Image Left, Chat Right</option>
                                    <option value="chat-left">Image Right, Chat Left</option>
                                    <option value="chat-bottom">Image Top, Chat Bottom</option>
                                </select>
                            </div>
                            <div>
                                <label className={`${labelClass} flex items-center gap-2`}><Type className="w-3 h-3" /> Text Model</label>
                                <select value={selectedTextModel} onChange={(e) => setSelectedTextModel(e.target.value)} className={fieldClass}>
                                    {availableTextModels.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className={`${labelClass} flex items-center gap-2`}><ImageIcon className="w-3 h-3" /> Image Model</label>
                                <select value={selectedImageModel} onChange={(e) => setSelectedImageModel(e.target.value)} className={fieldClass}>
                                    {availableImageModels.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                                </select>
                            </div>
                        </div>
                    )}

                    {settingsTab === 'fantasy' && (
                        <div className="space-y-4">
                            <p className="text-[11px] text-slate-400 leading-relaxed">Age lock, opener, heat, and who he’s texting steer the <span className="text-slate-200 font-semibold">next Roll</span> (dossier age, portrait, psychology) as well as Chat.</p>
                            <button type="button" onClick={applyDaddyPreset} className="w-full bg-amber-600/20 border border-amber-500/40 hover:bg-amber-600/30 text-amber-200 font-bold py-2 rounded-lg text-xs">Daddy preset (36–59, dad’s friend, filthy)</button>
                            <div>
                                <label className={labelClass}>Age lock</label>
                                <select value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)} className={fieldClass}>
                                    {AGE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className={labelClass}>Heat</label>
                                <select value={heat} onChange={(e) => setHeat(e.target.value)} className={fieldClass}>
                                    {HEAT_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className={labelClass}>Opener</label>
                                <select value={opener} onChange={(e) => setOpener(e.target.value)} className={fieldClass}>
                                    {OPENER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                </select>
                            </div>
                            <hr className="border-slate-700" />
                            <p className="text-[10px] font-bold text-slate-400 uppercase">You (who he’s texting)</p>
                            <div>
                                <label className={labelClass}>Your name</label>
                                <input type="text" value={userPersona.name} onChange={(e) => setUserPersona(p => ({ ...p, name: e.target.value }))} className={fieldClass} placeholder="Optional" />
                            </div>
                            <div>
                                <label className={labelClass}>Your age</label>
                                <input type="text" value={userPersona.age} onChange={(e) => setUserPersona(p => ({ ...p, age: e.target.value }))} className={fieldClass} placeholder="Optional" />
                            </div>
                            <div>
                                <label className={labelClass}>Call you</label>
                                <input type="text" value={userPersona.addressAs} onChange={(e) => setUserPersona(p => ({ ...p, addressAs: e.target.value }))} className={fieldClass} placeholder="e.g. kid, sweetheart" />
                            </div>
                            <div>
                                <label className={labelClass}>Notes / what you want</label>
                                <textarea value={userPersona.notes} onChange={(e) => setUserPersona(p => ({ ...p, notes: e.target.value }))} className={`${fieldClass} min-h-[72px]`} placeholder="Optional canon for him" />
                            </div>
                        </div>
                    )}

                    {settingsTab === 'saves' && (
                        <div className="space-y-3">
                            <button type="button" onClick={handleSaveSlot} disabled={!personaProfile} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold py-2 rounded-lg text-xs flex items-center justify-center gap-2"><Save className="w-3.5 h-3.5" /> Save slot</button>
                            <div className="flex gap-2">
                                <button type="button" onClick={handleExportJson} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 rounded-lg text-xs flex items-center justify-center gap-1"><FileDown className="w-3.5 h-3.5" /> Export JSON</button>
                                <button type="button" onClick={() => jsonImportRef.current?.click()} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-2 rounded-lg text-xs flex items-center justify-center gap-1"><Upload className="w-3.5 h-3.5" /> Import JSON</button>
                                <input type="file" accept="application/json,.json" className="hidden" ref={jsonImportRef} onChange={handleImportJson} />
                            </div>
                            <p className="text-[10px] text-slate-500">Current session autosaves in this browser. History keeps {HISTORY_CAP} portraits.</p>
                            {saveSlots.length === 0 ? (
                                <p className="text-xs text-slate-500 italic">No named slots yet.</p>
                            ) : saveSlots.map(slot => (
                                <div key={slot.id} className="flex items-center gap-2 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-bold text-slate-200 truncate">{slot.name}</p>
                                        <p className="text-[10px] text-slate-500">{slot.updatedAt ? new Date(slot.updatedAt).toLocaleString() : ''}</p>
                                    </div>
                                    <button type="button" onClick={() => handleLoadSlot(slot)} className="text-[10px] font-bold text-indigo-300 hover:text-white">Load</button>
                                    <button type="button" onClick={() => handleDeleteSlot(slot.id)} className="text-slate-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {showDossier && personaProfile && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                        <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-800/50">
                            <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                <Fingerprint className="w-5 h-5 text-indigo-400" /> Target Dossier: {personaProfile.core_identity.first_name}
                            </h2>
                            <div className="flex gap-2">
                                <button onClick={handleExportPersona} className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-2"><FileDown className="w-4 h-4" /> Export (.txt)</button>
                                <button onClick={() => setShowDossier(false)} className="bg-slate-700 hover:bg-red-500 text-white p-1.5 rounded-full transition-colors"><X className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-slate-700 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-900 to-slate-950">
                            {portraitStale && (
                                <p className="text-[11px] text-amber-200 bg-amber-900/30 border border-amber-600/40 rounded-lg px-3 py-2 mb-4">Portrait may be stale after a visual trait reroll. Switch to the Visualizer and describe the change, or Roll again.</p>
                            )}
                            <div className="space-y-6">
                                <div className="bg-gradient-to-br from-indigo-900/40 to-slate-800/40 p-6 rounded-xl border border-indigo-500/20 text-center shadow-inner">
                                    <div className="w-20 h-20 bg-slate-800 rounded-full mx-auto mb-4 flex items-center justify-center border-2 border-indigo-500/50 shadow-lg overflow-hidden">
                                        {generatedImage ? <img src={generatedImage} className="w-full h-full object-cover rounded-full" /> : <User className="w-10 h-10 text-slate-400" />}
                                    </div>
                                    <h3 className="text-2xl font-bold text-white mb-2">{personaProfile.core_identity.first_name}</h3>
                                    <p className="text-sm font-medium text-indigo-300 mb-3">{[personaProfile.mbti, personaProfile.enneagram].filter(Boolean).join(' · ') || '—'}</p>
                                    <p className="text-xs text-slate-400 bg-black/40 inline-block px-3 py-1.5 rounded-full border border-white/5">{personaProfile.core_identity.age_bracket} &bull; {firstBit(personaProfile.background_and_lifestyle?.current_profession)}</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><Heart className="w-3.5 h-3.5 text-pink-400" /> Identity & Romance</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <TraitRow label="Name" path="core_identity.first_name" value={personaProfile.core_identity.first_name} />
                                            <TraitRow label="Age" path="core_identity.age_bracket" value={personaProfile.core_identity.age_bracket} />
                                            <TraitRow label="Sexual" path="core_identity.sexual_orientation" value={personaProfile.core_identity.sexual_orientation} />
                                            <TraitRow label="Romantic" path="core_identity.romantic_orientation" value={personaProfile.core_identity.romantic_orientation} />
                                            <TraitRow label="Status" path="core_identity.relationship_structure" value={personaProfile.core_identity.relationship_structure} />
                                            <TraitRow label="Expression" path="core_identity.masculine_expression" value={personaProfile.core_identity.masculine_expression} />
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><User className="w-3.5 h-3.5 text-emerald-400" /> Physicality</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <TraitRow label="Height" path="physique_macro.height" value={personaProfile.physique_macro.height} />
                                            <TraitRow label="Body Type" path="physical_and_aesthetic.body_type" value={personaProfile.physical_and_aesthetic.body_type} />
                                            <TraitRow label="Composition" path="physique_macro.body_composition" value={personaProfile.physique_macro.body_composition} />
                                            <TraitRow label="Muscle" path="physique_macro.muscle_definition" value={personaProfile.physique_macro.muscle_definition} />
                                            <TraitRow label="Style" path="physical_and_aesthetic.style_vibe" value={personaProfile.physical_and_aesthetic.style_vibe} />
                                            <TraitRow label="Grooming" path="physical_and_aesthetic.grooming_habit" value={personaProfile.physical_and_aesthetic.grooming_habit} />
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><MessageSquare className="w-3.5 h-3.5 text-blue-400" /> Chat Style</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <TraitRow label="Habit" path="communication_style.texting_habit" value={personaProfile.communication_style.texting_habit} />
                                            <TraitRow label="Tone" path="communication_style.vocabulary_and_tone" value={personaProfile.communication_style.vocabulary_and_tone} />
                                            <TraitRow label="Emojis" path="communication_style.emoji_frequency" value={`${personaProfile.communication_style.emoji_frequency} - ${personaProfile.communication_style.emoji_usage}`} />
                                            <TraitRow label="Humor" path="communication_style.humor_style" value={personaProfile.communication_style.humor_style} />
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><Layers className="w-3.5 h-3.5 text-indigo-400" /> Background</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <TraitRow label="Job" path="background_and_lifestyle.current_profession" value={personaProfile.background_and_lifestyle.current_profession} />
                                            <TraitRow label="Class" path="background_and_lifestyle.socioeconomic_background" value={personaProfile.background_and_lifestyle.socioeconomic_background} />
                                            <TraitRow label="Hobbies" path="background_and_lifestyle.passions_hobbies" value={personaProfile.background_and_lifestyle.passions_hobbies} />
                                            <TraitRow label="Social Battery" path="background_and_lifestyle.social_battery" value={personaProfile.background_and_lifestyle.social_battery} />
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><BookOpen className="w-3.5 h-3.5 text-amber-400" /> Lore</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <TraitRow label="Origin" path="lore_origins.geographic_origin" value={personaProfile.lore_origins?.geographic_origin} />
                                            <TraitRow label="Family" path="family_architecture.structure" value={personaProfile.family_architecture?.structure} />
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-rose-500/20">
                                        <h4 className="text-[11px] font-bold text-rose-300 uppercase mb-3 flex items-center gap-1.5 border-b border-rose-500/20 pb-2"><Heart className="w-3.5 h-3.5 text-rose-400" /> Wounds</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <TraitRow label="Attachment" path="psychological_profile.attachment_style" value={personaProfile.psychological_profile?.attachment_style} />
                                            <TraitRow label="Vibe" path="psychological_profile.dominant_vibe" value={personaProfile.psychological_profile?.dominant_vibe} />
                                            <TraitRow label="Flaw" path="psychological_profile.fatal_flaw" value={personaProfile.psychological_profile?.fatal_flaw} />
                                            <TraitRow label="Daddy vector" path="psychological_profile.daddy_issues_vector" value={personaProfile.psychological_profile?.daddy_issues_vector} />
                                            <TraitRow label="Secret" path="hidden_vulnerabilities.deepest_secret" value={personaProfile.hidden_vulnerabilities?.deepest_secret} />
                                            <TraitRow label="Soft spot" path="hidden_vulnerabilities.soft_spot" value={personaProfile.hidden_vulnerabilities?.soft_spot} />
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-violet-500/30 md:col-span-2">
                                        <div className="flex justify-between items-center border-b border-violet-500/20 pb-2 mb-3">
                                            <h4 className="text-[11px] font-bold text-violet-300 uppercase flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 text-violet-400" /> Deep psychology (LLM)</h4>
                                            <button type="button" onClick={handleRerollPsychology} disabled={isRerollingPsych || !apiKey} className="text-[10px] font-bold text-violet-200 bg-violet-600/30 hover:bg-violet-600/50 disabled:opacity-40 px-2 py-1 rounded flex items-center gap-1">
                                                {isRerollingPsych ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Reroll psychology
                                            </button>
                                        </div>
                                        <ul className="text-xs text-slate-300 space-y-2 grid grid-cols-1 md:grid-cols-2 gap-x-4">
                                            <li><span className="text-slate-500">MBTI:</span> {personaProfile.mbti ?? '—'}</li>
                                            <li><span className="text-slate-500">Enneagram:</span> {personaProfile.enneagram ?? '—'}</li>
                                            <li className="md:col-span-2"><span className="text-slate-500">Alignment:</span> {personaProfile.moral_alignment ?? '—'}</li>
                                            <li className="md:col-span-2"><span className="text-slate-500">Unconscious fear:</span> {personaProfile.unconscious_fear ?? '—'}</li>
                                            <li className="md:col-span-2"><span className="text-slate-500">The lie they believe:</span> {personaProfile.the_lie_they_believe ?? '—'}</li>
                                            <li><span className="text-slate-500">Primary vice:</span> {personaProfile.primary_vice ?? '—'}</li>
                                            <li><span className="text-slate-500">Primary virtue:</span> {personaProfile.primary_virtue ?? '—'}</li>
                                            <li className="md:col-span-2 pt-1"><span className="text-slate-500 block mb-1">Short backstory</span> <span className="text-slate-200 leading-relaxed">{personaProfile.short_backstory ?? '—'}</span></li>
                                        </ul>
                                        <div className="mt-3 pt-3 border-t border-slate-700/50">
                                            <p className="text-[10px] font-bold text-violet-400/90 uppercase mb-2">Behavioral rules (roleplay)</p>
                                            <ol className="text-[11px] text-slate-300 space-y-1.5 list-decimal list-inside">
                                                {(personaProfile.behavioral_rules && personaProfile.behavioral_rules.length > 0)
                                                    ? personaProfile.behavioral_rules.map((r, i) => <li key={i} className="leading-snug">{r}</li>)
                                                    : <li className="text-slate-500">—</li>}
                                            </ol>
                                        </div>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><Mic className="w-3.5 h-3.5 text-cyan-400" /> Voice &amp; Habits</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <TraitRow label="Resonance" path="voice_and_speech.vocal_resonance" value={personaProfile.voice_and_speech?.vocal_resonance} />
                                            <TraitRow label="Pattern" path="voice_and_speech.speech_patterns" value={personaProfile.voice_and_speech?.speech_patterns} />
                                            <TraitRow label="Accent" path="voice_and_speech.accent_profile" value={personaProfile.voice_and_speech?.accent_profile} />
                                            <TraitRow label="Scent" path="micro_details.scent_profile" value={personaProfile.micro_details?.scent_profile} />
                                            <TraitRow label="Motor tic" path="kinematics_motor_control.fidgets_tics" value={personaProfile.kinematics_motor_control?.fidgets_tics} />
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50 md:col-span-2">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><Flame className="w-3.5 h-3.5 text-orange-400" /> Intimacy Dynamics</h4>
                                        <ul className="text-xs text-slate-300 space-y-2 grid grid-cols-1 md:grid-cols-2 gap-x-4">
                                            <TraitRow label="Dynamic" path="intimacy_dynamics.power_dynamic" value={personaProfile.intimacy_dynamics.power_dynamic} />
                                            <TraitRow label="Pacing" path="intimacy_dynamics.pacing" value={personaProfile.intimacy_dynamics.pacing} />
                                            <TraitRow label="Flirting" path="intimacy_dynamics.flirting_approach" value={personaProfile.intimacy_dynamics.flirting_approach} />
                                            <TraitRow label="Role" path="intimacy_dynamics.role_preference" value={personaProfile.intimacy_dynamics.role_preference} />
                                            <TraitRow label="Kinks" path="intimacy_dynamics.kinks_interests" value={personaProfile.intimacy_dynamics.kinks_interests} span />
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showHistory && (
                <div className="absolute inset-y-0 left-0 w-full sm:w-80 bg-slate-900/95 backdrop-blur-xl border-r border-slate-700 z-40 flex flex-col shadow-2xl animate-in slide-in-from-left-4">
                    <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                        <h2 className="font-bold text-slate-200">History</h2>
                        <button onClick={() => setShowHistory(false)} className="p-1 hover:bg-slate-700 rounded-full"><X className="w-5 h-5 text-slate-400" /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                        {generationHistory.length === 0 ? (
                            <p className="text-slate-500 text-sm text-center italic mt-10">No history yet.</p>
                        ) : (
                            generationHistory.map((item) => (
                                <div key={item.id} onClick={() => restoreHistoryItem(item)} className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700 hover:border-indigo-500 cursor-pointer transition-all group flex h-24 shadow-sm">
                                    <div className="w-24 bg-slate-950 flex-shrink-0 relative">
                                        {item.image ? <img src={(visualStyle === 'photo' && item.imagePhoto) || (visualStyle === '3d' && item.image3d) || item.image} alt="Thumbnail" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" /> : <User className="w-8 h-8 text-slate-600 m-auto mt-8" />}
                                    </div>
                                    <div className="p-3 flex-1 min-w-0 flex flex-col justify-center">
                                        <p className="font-bold text-sm text-slate-200 truncate">{item.profile?.core_identity?.first_name || 'Unknown'}</p>
                                        <p className="text-[11px] text-indigo-400 truncate mb-1">{(() => {
                                            const tag = [item.profile?.mbti, item.profile?.enneagram].filter(Boolean).join(' · ');
                                            if (tag) return tag;
                                            const s = item.profile?.short_backstory;
                                            if (!s) return '';
                                            return s.length > 52 ? `${s.slice(0, 52)}…` : s;
                                        })()}</p>
                                        <p className="text-[10px] text-slate-500 mt-auto">{item.timestamp}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            <div className={`flex flex-1 min-h-0 ${layout === 'chat-bottom' ? 'flex-col' : 'flex-row'}`}>

                <div className={`flex-1 min-h-0 min-w-0 flex flex-col bg-slate-950 relative overflow-hidden ${layout === 'chat-left' ? 'order-2' : 'order-1'}`}>
                    <div className="flex-1 flex items-center justify-center p-4 overflow-hidden relative">
                        {generatedImage ? (
                            <div className="relative group h-full w-full flex items-center justify-center">
                                <div className="relative max-h-full max-w-full cursor-zoom-in shadow-2xl rounded-xl overflow-hidden border border-slate-800 bg-slate-900 transition-transform active:scale-[0.99]" onClick={() => setFullScreenImageUrl(generatedImage)}>
                                    <img src={generatedImage} alt="Generated" className="max-h-full max-w-full object-contain" />
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all pointer-events-none">
                                        <div className="bg-black/60 backdrop-blur px-3 py-1 rounded-full text-xs font-medium text-white flex items-center gap-1"><Maximize2 className="w-3 h-3" /> Full Screen</div>
                                    </div>
                                </div>
                                <div className="absolute top-4 left-4 z-10 flex gap-2">
                                    <button onClick={downloadImage} className="bg-black/50 hover:bg-black/70 backdrop-blur text-white p-2 rounded-lg border border-white/10 shadow-lg" title="Download"><Download className="w-4 h-4" /></button>
                                    <button onClick={() => setGeneratedImage(null)} className="bg-black/50 hover:bg-red-500/70 backdrop-blur text-white p-2 rounded-lg border border-white/10 shadow-lg" title="Clear Image"><Eraser className="w-4 h-4" /></button>
                                </div>
                                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2">
                                    {portraitStale && (
                                        <span className="bg-amber-900/80 backdrop-blur text-amber-100 text-[10px] px-2 py-1 rounded-full border border-amber-500/40">Portrait may be stale — edit in Visualizer</span>
                                    )}
                                    <span className="bg-black/50 backdrop-blur text-slate-300 text-[10px] px-2 py-1 rounded-full border border-white/10">Editing Enabled</span>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center p-8 border-2 border-dashed border-slate-800 rounded-3xl opacity-50 select-none">
                                <User className="w-16 h-16 mx-auto mb-4 text-slate-700" />
                                <p className="text-slate-500 font-medium">{isGlobalRolling ? 'Synthesizing character...' : 'Visualization Workspace'}</p>
                            </div>
                        )}
                        {error && activeMainTab === 'visualizer' && (
                            <div className="absolute top-4 left-4 right-4 mx-auto max-w-md bg-red-900/90 text-red-100 px-4 py-3 rounded-lg flex items-start gap-3 backdrop-blur shadow-xl text-sm z-20 border border-red-700 animate-in slide-in-from-top-4">
                                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                                <span>{error}</span>
                                <button onClick={() => setError(null)} className="ml-auto hover:bg-red-800 rounded p-1"><X className="w-4 h-4" /></button>
                            </div>
                        )}
                    </div>
                </div>

                <div className={`flex flex-col bg-slate-900 z-20 ${layout === 'chat-left' ? 'order-1' : 'order-2'} ${layout === 'chat-bottom' ? 'flex-none h-[40vh] min-h-[200px] border-t border-slate-700 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]' : `flex-none w-[40%] min-w-[280px] max-w-[500px] h-full ${layout === 'chat-left' ? 'border-r border-slate-700' : 'border-l border-slate-700'}`}`}>

                    <div className={`flex-none bg-slate-900 border-b border-slate-800 px-3 py-2.5 flex flex-col gap-2 z-20 shadow-sm ${layout === 'chat-bottom' ? 'border-t' : ''}`}>
                        <div className="flex justify-between items-center gap-2">
                            <div className="flex bg-slate-800/80 rounded-lg p-1 border border-slate-700/50 shrink-0 min-w-0">
                                <button onClick={() => setActiveMainTab('visualizer')} className={`px-3 py-2 text-[12px] font-bold rounded-md flex items-center gap-1.5 transition-all ${activeMainTab === 'visualizer' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                                    <Palette className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Visualizer</span>
                                </button>
                                <button onClick={() => setActiveMainTab('chat')} disabled={!personaProfile} className={`px-3 py-2 text-[12px] font-bold rounded-md flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${activeMainTab === 'chat' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                                    <MessageCircle className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Chat with {personaProfile?.core_identity?.first_name || 'Target'}</span>
                                </button>
                            </div>
                            <button type="button" onClick={generateNewBase} disabled={isGlobalRolling || isVisImageLoading || isVisTextLoading || isChatTyping} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 sm:px-4 py-2 rounded-full font-bold text-sm shadow-lg shadow-emerald-900/30 transition-all transform hover:scale-105 active:scale-95 shrink-0">
                                {isGlobalRolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Dices className="w-4 h-4 animate-bounce" />}
                                <span className="hidden sm:inline">Roll Character</span>
                                <span className="sm:hidden">Roll</span>
                            </button>
                        </div>
                        <input
                            type="text"
                            value={characterConcept}
                            onChange={(e) => setCharacterConcept(e.target.value)}
                            placeholder="Optional character concept (e.g., 'grumpy goth librarian')..."
                            disabled={isGlobalRolling || isVisImageLoading || isVisTextLoading || isChatTyping}
                            className="w-full bg-slate-800/90 text-white border border-slate-600 rounded-lg px-3 py-2 text-[11px] focus:outline-none focus:border-emerald-500/60 disabled:opacity-50"
                        />
                    </div>

                    <div className="flex-1 flex flex-col relative min-h-0">

                        {activeMainTab === 'visualizer' && (
                            <div className="absolute inset-0 flex flex-col bg-slate-900 animate-in fade-in duration-200">
                                <div className="px-4 py-2 bg-slate-800/80 border-b border-slate-700 flex items-center gap-2 backdrop-blur-sm flex-none">
                                    <MessageSquare className="w-4 h-4 text-slate-400" />
                                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Detail Editor</span>
                                </div>
                                <div className="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-slate-700 space-y-3">
                                    {visChatHistory.map((msg, idx) => (
                                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            {msg.type === 'prompt' ? (
                                                <div className="bg-slate-800/80 border border-indigo-500/30 rounded-lg p-3 shadow-sm w-full max-w-[90%]">
                                                    <div className="flex justify-between items-center mb-2 border-b border-slate-700/50 pb-2">
                                                        <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1"><Sparkles className="w-3 h-3" /> Generated Prompt</span>
                                                        <button onClick={() => copyText(msg.text, idx)} className="text-slate-400 hover:text-white flex items-center gap-1 text-[10px] bg-slate-700/50 px-2 py-1 rounded">
                                                            {copyFeedback[idx] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copyFeedback[idx] ? 'Copied' : 'Copy'}
                                                        </button>
                                                    </div>
                                                    <p className="text-xs font-mono text-slate-300 whitespace-pre-wrap leading-relaxed opacity-90">{msg.text}</p>
                                                </div>
                                            ) : msg.type === 'safety-recovery' ? (
                                                <div className="bg-orange-900/20 border border-orange-500/40 rounded-lg p-3 w-full max-w-[90%]">
                                                    <div className="flex items-start gap-2 mb-2">
                                                        <ShieldAlert className="w-4 h-4 text-orange-400 mt-0.5" />
                                                        <div>
                                                            <h4 className="text-xs font-bold text-orange-200">Safety Filter Triggered</h4>
                                                            <p className="text-[10px] text-orange-200/80">Proposed safe version:</p>
                                                        </div>
                                                    </div>
                                                    <p className="text-[10px] font-mono text-slate-300 italic line-clamp-3 mb-2 bg-black/30 p-2 rounded">{msg.proposedPrompt}</p>
                                                    <button onClick={() => handleRetrySafeVis(msg.proposedPrompt)} className="bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-bold py-1.5 px-3 rounded flex items-center gap-1 w-fit">Retry Safe <ArrowRight className="w-3 h-3" /></button>
                                                </div>
                                            ) : (
                                                <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-sm'}`}>
                                                    {msg.text}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {(isVisTextLoading || isVisImageLoading || isVisSanitizing) && (
                                        <div className="flex justify-start">
                                            <div className="bg-slate-800 border border-slate-700 text-slate-400 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-2">
                                                {isVisSanitizing ? <ShieldAlert className="w-4 h-4 animate-pulse text-orange-500" /> : isVisTextLoading ? <RefreshCw className="w-4 h-4 animate-spin text-indigo-500" /> : <ImageIcon className="w-4 h-4 animate-pulse text-purple-500" />}
                                                <span className="text-xs font-medium">{isVisSanitizing ? 'Rewriting prompt...' : isVisTextLoading ? 'Refining prompt...' : `Rendering with ${selectedImageModel}...`}</span>
                                            </div>
                                        </div>
                                    )}
                                    <div ref={visChatEndRef} />
                                </div>
                                <div className="p-3.5 bg-slate-800 border-t border-slate-700 flex-none">
                                    <form onSubmit={handleVisChatSubmit} className="flex gap-2">
                                        <input type="text" value={visUserInput} onChange={(e) => setVisUserInput(e.target.value)} placeholder={generatedImage ? "Describe modification (e.g., 'Make his hair silver')" : 'Type a visual edit after rolling, or use Roll Character'} className="flex-1 bg-slate-900 text-white border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 transition-all text-sm disabled:opacity-50 shadow-inner" disabled={isVisTextLoading || isVisImageLoading || isVisSanitizing} />
                                        <button type="submit" disabled={isVisTextLoading || isVisImageLoading || isVisSanitizing || !visUserInput.trim()} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 rounded-lg flex items-center justify-center shadow-md"><Send className="w-5 h-5" /></button>
                                    </form>
                                </div>
                            </div>
                        )}

                        {activeMainTab === 'chat' && (
                            <div className="absolute inset-0 flex flex-col bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-[#0b101a] to-[#0b101a] animate-in fade-in duration-200">
                                <div className="px-5 py-2.5 bg-slate-800/60 border-b border-slate-700/50 backdrop-blur-md flex items-center justify-between shadow-sm flex-none">
                                    <div className="flex items-center gap-3">
                                        <div className="relative">
                                            <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center border border-slate-600 overflow-hidden shadow-sm">
                                                {generatedImage ? <img src={generatedImage} className="w-full h-full object-cover" /> : <User className="w-4 h-4 text-slate-400" />}
                                            </div>
                                            {personaProfile && <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-slate-800 rounded-full"></div>}
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-bold text-white leading-none">{personaProfile?.core_identity?.first_name || 'Target'}</h3>
                                            <p className="text-[10px] text-purple-300 font-medium">{isChatTyping ? 'Typing...' : 'Active now'}</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-thin scrollbar-thumb-slate-700">
                                    <div className="space-y-4">
                                        {error && activeMainTab === 'chat' && (
                                            <div className="flex justify-center mb-4">
                                                <span className="bg-red-900/80 text-red-200 text-xs px-3 py-1 rounded shadow-sm flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {error}</span>
                                            </div>
                                        )}
                                        {roleplayUiChat.map((msg) => {
                                            if (msg.role === 'system') {
                                                return <div key={msg.id} className="flex justify-center my-4"><span className="bg-slate-800/60 border border-slate-700/50 backdrop-blur text-slate-400 text-[10px] uppercase tracking-wider px-4 py-1 rounded-full shadow-sm">{msg.text}</span></div>;
                                            }
                                            const isUser = msg.role === 'user';
                                            return (
                                                <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'} chat-bubble`}>
                                                    {!isUser && (
                                                        <div className="w-6 h-6 bg-slate-800 rounded-full flex-shrink-0 mr-2 mt-auto mb-1 border border-slate-700 flex items-center justify-center overflow-hidden">
                                                            {generatedImage ? <img src={generatedImage} className="w-full h-full object-cover" /> : <User className="w-3 h-3 text-slate-500" />}
                                                        </div>
                                                    )}
                                                    <div className={`max-w-[80%] md:max-w-[70%] text-[15px] leading-relaxed shadow-sm flex flex-col overflow-hidden ${isUser ? 'bg-purple-600 text-white rounded-2xl rounded-br-sm' : 'bg-slate-800 text-slate-200 rounded-2xl rounded-bl-sm border border-slate-700'}`}>
                                                        {msg.image && <img src={msg.image} alt="Attached" className={`w-full h-auto object-cover max-h-64 cursor-zoom-in hover:opacity-90 transition-opacity ${msg.text ? 'border-b border-black/20' : ''}`} onClick={() => setFullScreenImageUrl(msg.image)} />}
                                                        {msg.text && <div className="px-4 py-2.5 whitespace-pre-wrap">{msg.text}</div>}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        {isChatTyping && (
                                            <div className="flex justify-start chat-bubble">
                                                <div className="w-6 h-6 bg-slate-800 rounded-full flex-shrink-0 mr-2 mt-auto mb-1 border border-slate-700 overflow-hidden">
                                                    {generatedImage ? <img src={generatedImage} className="w-full h-full object-cover" /> : <User className="w-3 h-3 text-slate-500 m-auto mt-1" />}
                                                </div>
                                                <div className="bg-slate-800 border border-slate-700 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-1 shadow-sm">
                                                    <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                                    <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                                    <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                                </div>
                                            </div>
                                        )}
                                        <div ref={rpChatEndRef} />
                                    </div>
                                </div>

                                <div className="p-4 bg-slate-900 border-t border-slate-800 flex-none flex flex-col gap-2">
                                    {pendingImage && (
                                        <div className="flex items-center gap-2 bg-slate-800 w-fit p-2 rounded-lg border border-slate-700 animate-in slide-in-from-bottom-2">
                                            <div className="w-12 h-12 rounded overflow-hidden bg-black flex-shrink-0"><img src={pendingImage} className="w-full h-full object-cover" /></div>
                                            <button onClick={() => setPendingImage(null)} className="p-1 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
                                        </div>
                                    )}
                                    <form onSubmit={handleRpSubmit} className="flex gap-2 relative w-full">
                                        <div className="relative flex-1 flex items-center">
                                            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!personaProfile || isChatTyping} className="absolute left-2 p-2 text-slate-400 hover:text-purple-400 disabled:opacity-50 transition-colors z-10"><Paperclip className="w-5 h-5" /></button>
                                            <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
                                            <input type="text" ref={rpInputRef} value={roleplayUserInput} onChange={(e) => setRoleplayUserInput(e.target.value)} placeholder={personaProfile ? 'Type a message...' : 'Roll Character to chat'} disabled={!personaProfile || isChatTyping} className="w-full bg-slate-800 text-white border border-slate-700 rounded-full pl-12 pr-4 py-3 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all text-[15px] disabled:opacity-50 shadow-inner" />
                                        </div>
                                        <button type="submit" disabled={!personaProfile || isChatTyping || (!roleplayUserInput.trim() && !pendingImage)} className="bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white aspect-square rounded-full flex items-center justify-center px-4 shadow-md transition-colors"><Send className="w-5 h-5 ml-0.5" /></button>
                                    </form>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {fullScreenImageUrl && (
                <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col animate-in fade-in duration-200">
                    <div className="absolute top-4 right-4 flex gap-4 z-50">
                        <button onClick={downloadImage} className="bg-white/10 hover:bg-white/20 text-white p-3 rounded-full backdrop-blur-md"><Download className="w-6 h-6" /></button>
                        <button onClick={() => setFullScreenImageUrl(null)} className="bg-white/10 hover:bg-red-500/80 text-white p-3 rounded-full backdrop-blur-md"><X className="w-6 h-6" /></button>
                    </div>
                    <div className="flex-1 p-4 flex items-center justify-center overflow-hidden" onClick={() => setFullScreenImageUrl(null)}>
                        <img src={fullScreenImageUrl} alt="Full Screen" className="max-w-full max-h-full object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
                    </div>
                </div>
            )}
        </div>
    );
};

const LoadingScreen = () => (
    <div className="flex items-center justify-center h-screen bg-slate-900">
        <div className="text-center">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin mx-auto mb-4" />
            <p className="text-slate-400 text-sm">Loading Adonis Engine...</p>
        </div>
    </div>
);

const AppBootstrap = () => {
    const [appData, setAppData] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [isDataLoading, setIsDataLoading] = useState(true);

    useEffect(() => {
        setIsDataLoading(true);
        loadAppData()
            .then(setAppData)
            .catch(err => setLoadError(err.message))
            .finally(() => setIsDataLoading(false));
    }, []);

    if (loadError) {
        return (
            <div className="flex items-center justify-center h-screen bg-slate-900">
                <div className="text-center text-red-400 p-8">
                    <AlertCircle className="w-10 h-10 mx-auto mb-4" />
                    <h2 className="text-lg font-bold mb-2">Failed to load app data</h2>
                    <p className="text-sm text-slate-500">{loadError}</p>
                </div>
            </div>
        );
    }

    if (isDataLoading || !appData) return <LoadingScreen />;

    return <AdonisEngineApp appData={appData} />;
};

const root = createRoot(document.getElementById('root'));
root.render(<AppBootstrap />);
