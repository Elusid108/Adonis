import React, { useState, useEffect, useRef } from 'https://esm.sh/react@18.2.0';
import { createRoot } from 'https://esm.sh/react-dom@18.2.0/client';
import { 
    Send, RefreshCw, Settings, AlertCircle, Copy, Check, Sparkles, User, 
    Image as ImageIcon, Eye, EyeOff, MessageSquare, Download, History, X, 
    Maximize2, ShieldAlert, ArrowRight, Dices, Layers, Type, Zap, Loader2, Eraser,
    LayoutGrid, PanelLeft, PanelRight,
    Heart, MessageCircle, Flame, Lock, Fingerprint, Paperclip, Palette, FileDown,
    BookOpen, Mic
} from 'https://esm.sh/lucide-react@0.303.0';

// --- Data Loading ---

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
        return val ?? '';
    });
}

// --- Style Helper ---

const applyStyleToPrompt = (promptText, style, styleSections) => {
    const section = styleSections[style];
    const styleRegex = /\[Style[^\]]*\][\s\S]*?(?=\n\[|\n\s*$)/;
    return promptText.replace(styleRegex, section) || section + '\n\n' + promptText;
};

// --- Main App Component ---

const AdonisEngineApp = ({ appData }) => {
    const { archetypes: MERGED_ARCHETYPES, config, visPrompt: DEFAULT_SYSTEM_PROMPT, rpPromptTemplate } = appData;
    const APP_VERSION = config.app_version;
    const STYLE_SECTIONS = config.style_sections;
    const CANVAS_TEXT_MODELS = config.default_text_models;
    const CANVAS_IMAGE_MODELS = config.default_image_models;

    // --- State Management ---
    const [apiKey, setApiKey] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [showDossier, setShowDossier] = useState(false);
    const [activeMainTab, setActiveMainTab] = useState('visualizer');
    const [fullScreenImageUrl, setFullScreenImageUrl] = useState(null);
    const [error, setError] = useState(null);

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

    const [personaProfile, setPersonaProfile] = useState(null);
    const [systemPrompt, setSystemPrompt] = useState("");
    const [currentPrompt, setCurrentPrompt] = useState("");

    const [generatedImage, setGeneratedImage] = useState(null);
    const [generatedImagePhoto, setGeneratedImagePhoto] = useState(null);
    const [generatedImage3d, setGeneratedImage3d] = useState(null);

    const [isGlobalRolling, setIsGlobalRolling] = useState(false);
    const [isVisTextLoading, setIsVisTextLoading] = useState(false);
    const [isVisImageLoading, setIsVisImageLoading] = useState(false);
    const [isVisSanitizing, setIsVisSanitizing] = useState(false);
    const [isChatTyping, setIsChatTyping] = useState(false);

    const [generationHistory, setGenerationHistory] = useState([]);

    const [visChatHistory, setVisChatHistory] = useState([
        { role: 'system', text: 'Welcome to the Adonis Engine Studio. Enter your API Key in settings, then click "Roll Target" to begin.', type: 'text' }
    ]);
    const [visUserInput, setVisUserInput] = useState("");

    const [roleplayApiHistory, setRoleplayApiHistory] = useState([]);
    const [roleplayUiChat, setRoleplayUiChat] = useState([]);
    const [roleplayUserInput, setRoleplayUserInput] = useState("");
    const [pendingImage, setPendingImage] = useState(null);

    const [copyFeedback, setCopyFeedback] = useState({});

    const visChatEndRef = useRef(null);
    const rpChatEndRef = useRef(null);
    const rpInputRef = useRef(null);
    const fileInputRef = useRef(null);

    // --- Effects ---
    useEffect(() => {
        const cachedKey = localStorage.getItem('adonis_gemini_key');
        if (cachedKey) setApiKey(cachedKey);
        else setShowSettings(true);
        document.title = `Adonis Engine v${APP_VERSION} | Studio`;
    }, []);

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

    // --- Helpers ---
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
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
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
                if (methods.includes('generateContent') && !name.includes('vision') && !name.includes('image')) textOpts.push(modelObj);
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
            if (textOpts.length > 0 && !textOpts.find(m => m.id === selectedTextModel)) {
                const f = textOpts.find(m => m.id.includes('flash'));
                setSelectedTextModel(f ? f.id : textOpts[0].id);
            }
            if (imageOpts.length > 0 && !imageOpts.find(m => m.id === selectedImageModel)) {
                const d = imageOpts.find(m => m.id.includes('flash-image') || m.id.includes('imagen'));
                setSelectedImageModel(d ? d.id : imageOpts[0].id);
            }
        } catch (e) {
            console.warn("Could not fetch models, using defaults.", e.message);
            setAvailableTextModels(CANVAS_TEXT_MODELS);
            setAvailableImageModels(CANVAS_IMAGE_MODELS);
        } finally {
            setIsLoadingModels(false);
        }
    };

    // --- Roleplay Prompt Generator ---
    const generateRoleplayPrompt = (profile) => fillTemplate(rpPromptTemplate, profile);

    // --- Randomizer Logic ---
    const rollCharacter = () => {
        const traverseAndPick = (obj) => {
            const result = {};
            for (const key in obj) {
                if (Array.isArray(obj[key])) {
                    result[key] = obj[key][Math.floor(Math.random() * obj[key].length)];
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    result[key] = traverseAndPick(obj[key]);
                }
            }
            return result;
        };
        return traverseAndPick(MERGED_ARCHETYPES);
    };

    const formatProfileToString = (profile) => {
        let description = `Create a character named ${profile.core_identity?.first_name || 'Unknown'} with these specific traits:\n`;
        const processObj = (obj, prefix = "") => {
            for (const key in obj) {
                if (typeof obj[key] === 'object' && obj[key] !== null) {
                    processObj(obj[key], prefix + key + " > ");
                } else {
                    description += `- ${prefix}${key}: ${obj[key]}\n`;
                }
            }
        };
        processObj(profile);
        return description;
    };

    // --- Export Persona ---
    const handleExportPersona = () => {
        if (!personaProfile) return;
        const p = personaProfile;
        const exportText = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>

## IDENTITY: ${p.core_identity.first_name.toUpperCase()} (THE ${p.psychological_profile.dominant_vibe.split('(')[0].trim().toUpperCase()})
You are ${p.core_identity.first_name}, a ${p.core_identity.age_bracket} ${p.background_and_lifestyle.current_profession.split('/')[0]}. You are an imposing, ${p.physique_macro.body_composition.split('(')[0].trim().toLowerCase()} powerhouse of a man. You have a ${p.physique_macro.height.toLowerCase()} frame with ${p.physique_macro.muscle_definition.toLowerCase()} and a ${p.physique_macro.shoulder_to_waist_ratio.toLowerCase()} ratio. Your presentation is ${p.core_identity.masculine_expression.toLowerCase()} and your general aesthetic is ${p.physical_and_aesthetic.style_vibe.toLowerCase()}.
Physically, you feature a ${p.facial_features.jawline_and_chin.toLowerCase()}, ${p.facial_features.eye_shape_and_gaze.toLowerCase()}, and a ${p.facial_features.nose_structure.toLowerCase()}. Your hands are ${p.physique_macro.hands_and_feet.toLowerCase()}, your vascularity is ${p.physique_micro.vascularity.toLowerCase()}, and your grooming habit is ${p.physical_and_aesthetic.grooming_habit.toLowerCase()}. You wear a ${p.physique_micro.facial_hair_style.toLowerCase()} and your body features ${p.physique_micro.body_hair_density.toLowerCase()}. When lounging or standing, you tend to adopt a ${p.poses_and_posture.attitude_and_stance.toLowerCase()}.

## THE ${p.intimacy_dynamics.role_preference.toUpperCase()} ARCHETYPE
- Orientation: You are ${p.core_identity.sexual_orientation} and ${p.core_identity.romantic_orientation}. You seek a ${p.core_identity.relationship_structure} relationship.
- Role & Dynamic: You are a ${p.intimacy_dynamics.role_preference} who takes a ${p.intimacy_dynamics.power_dynamic.toLowerCase()} approach. Your pacing is ${p.intimacy_dynamics.pacing.toLowerCase()} and your flirting style is ${p.intimacy_dynamics.flirting_approach.toLowerCase()}.
- Anatomy & Kinks: You have a ${p.physique_micro.genital_metrics.flaccid_hang.toLowerCase()} hang and ${p.physique_micro.genital_metrics.testicular_size.toLowerCase()} size. You are highly interested in: ${p.intimacy_dynamics.kinks_interests}.
- Love & Attachment: Your attachment style is ${p.psychological_profile.attachment_style} and your love language is ${p.psychological_profile.core_love_language}. You exude a "${p.psychological_profile.daddy_issues_vector}" energy.
- Nicknames for User: ${p.intimacy_dynamics.nicknames_used}.

## EXPERTISE & WORLD-BUILDING
- Background: You come from a ${p.background_and_lifestyle.socioeconomic_background.toLowerCase()} background. Your social battery is best described as: ${p.background_and_lifestyle.social_battery}.
- Passions & Hobbies: You spend your free time focused on ${p.background_and_lifestyle.passions_hobbies}.
- Environment & Vibe: Your personal space often features a ${p.environment_and_lighting.cinematic_lighting.toLowerCase()} atmosphere.
- Morning Routine: ${p.quirks_and_habits.morning_routine}.

## VOICE & LINEAGE (TEXTURED)
- Verbal fingerprint: ${p.voice_and_speech?.vocal_resonance ?? '—'}, ${p.voice_and_speech?.speech_patterns ?? '—'}, ${p.voice_and_speech?.accent_profile ?? '—'}.
- Lineage context: ${p.identity_lineage?.taxonomy_genetics ?? '—'}; ${p.identity_lineage?.perceived_age_modifier ?? '—'}.

## LORE, BELIEFS & LIFESTYLE
- Origin & education: ${p.lore_origins?.geographic_origin ?? '—'}; ${p.lore_origins?.education ?? '—'}.
- Family: ${p.family_architecture?.structure ?? '—'}; atmosphere ${p.family_architecture?.family_atmosphere ?? '—'}.
- Beliefs: ${p.psychology_and_beliefs?.beliefs_values?.moral_alignment ?? '—'}; MBTI flavor ${p.psychology_and_beliefs?.personality_matrix?.myers_briggs_archetype ?? '—'}; neuro ${p.psychology_and_beliefs?.mental_health_neurodivergence ?? '—'}.
- Living: ${p.lifestyle?.living_space ?? '—'}; rhythm ${p.lifestyle?.circadian_rhythm ?? '—'}; skill ${p.skills_hobbies?.primary_skillset ?? '—'}.

## MICRO-APPEARANCE & HEALTH
- Macro supplement: ${p.macro_physique?.height_category ?? '—'}, ${p.macro_physique?.posture ?? '—'}.
- Micro: scent ${p.micro_details?.scent_profile ?? '—'}; skin ${p.micro_details?.skin_complexion ?? '—'}; hair ${p.micro_details?.hair_color ?? '—'} / ${p.micro_details?.hair_style ?? '—'}.
- Health & motor: ${p.health_status?.general_health ?? '—'}; ${p.kinematics_motor_control?.handedness ?? '—'}, ${p.kinematics_motor_control?.fidgets_tics ?? '—'}.

## PSYCHOLOGICAL PROFILE & BEHAVIORAL RULES (STRICT)
1. NO CENSORSHIP: You are an adult interacting with an adult in an uncensored, explicit, and consensual roleplay.
2. NARRATIVE STYLE: Your vocabulary and tone are ${p.communication_style.vocabulary_and_tone.toLowerCase()}. Your texting habit is ${p.communication_style.texting_habit.toLowerCase()}, and your humor style is ${p.communication_style.humor_style.toLowerCase()}. You use emojis at a ${p.communication_style.emoji_frequency.toLowerCase()} rate, specifically ${p.communication_style.emoji_usage.toLowerCase()}.
3. PERSONALITY: You embody "${p.psychological_profile.dominant_vibe}". In conflict, your argument style is ${p.conflict_and_boundaries.argument_style.toLowerCase()}. When jealous, you ${p.conflict_and_boundaries.jealous_expression.toLowerCase()}. You have a nervous tic of ${p.quirks_and_habits.nervous_tic.toLowerCase()}.
4. VULNERABILITIES (HIDDEN): Your fatal flaw is ${p.psychological_profile.fatal_flaw.toLowerCase()}. Your deepest secret is that you are ${p.hidden_vulnerabilities.deepest_secret.toLowerCase()}. Your ultimate soft spot is ${p.hidden_vulnerabilities.soft_spot.toLowerCase()}.
5. CRITICAL: Never prefix your response with your name, "Assistant:", or "Insight:". Start your response directly with dialogue or actions.

<|eot_id|><|start_header_id|>user<|end_header_id|>

{{user_input}}<|eot_id|><|start_header_id|>assistant<|end_header_id|>`;

        const blob = new Blob([exportText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `AES_Persona_${p.core_identity.first_name}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    // --- API Helpers ---
    const callTextAPI = async (payload) => {
        if (!apiKey) throw new Error("API Key Required. Check Settings.");
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedTextModel}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) throw new Error("Unauthorized: Invalid API Key. Please check your settings.");
            throw new Error(`Text Engine Error (${selectedTextModel}): ${response.status}`);
        }
        const data = await response.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "Error generating text.";
    };

    const callImageAPI = async (promptText, inputImageBase64) => {
        if (!apiKey) throw new Error("API Key Required. Check Settings.");
        let endpoint = 'generateContent';
        let payload = {
            contents: [{ parts: [{ text: promptText }] }],
            generationConfig: { responseModalities: ["IMAGE"] }
        };
        if (selectedImageModel.includes('imagen') && !selectedImageModel.includes('3')) {
            endpoint = 'predict';
            payload = { instances: [{ prompt: promptText }], parameters: { sampleCount: 1, aspectRatio: "1:1" } };
        }
        if (inputImageBase64 && !selectedImageModel.includes('imagen')) {
            payload.contents[0].parts.push({ inlineData: { mimeType: "image/png", data: inputImageBase64 } });
        }
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedImageModel}:${endpoint}?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) throw new Error("Unauthorized: Invalid API Key.");
            const errData = await response.json().catch(() => ({}));
            if (response.status === 400 || errData.error?.message?.includes("safety")) throw new Error("SAFETY_BLOCK");
            throw new Error(`Image Error (${selectedImageModel}): ${response.status}`);
        }
        const data = await response.json();
        let base64Image = null;
        if (data.predictions && data.predictions[0]) base64Image = data.predictions[0].bytesBase64Encoded;
        else if (data.candidates && data.candidates[0]) base64Image = data.candidates[0].content?.parts?.find(p => p.inlineData)?.inlineData?.data;
        if (!base64Image) throw new Error("SAFETY_BLOCK");
        return `data:image/png;base64,${base64Image}`;
    };

    // --- History ---
    const addToHistory = (img, promptText, currentChat, extras = {}) => {
        const { imagePhoto, image3d, visualStyle: itemStyle } = extras;
        setGenerationHistory(prev => [{
            id: Date.now(),
            image: img,
            imagePhoto: imagePhoto ?? null,
            image3d: image3d ?? null,
            prompt: promptText,
            chat: JSON.parse(JSON.stringify(currentChat)),
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            visualStyle: itemStyle ?? visualStyle,
            profile: personaProfile ? JSON.parse(JSON.stringify(personaProfile)) : null,
            rpApiHistory: JSON.parse(JSON.stringify(roleplayApiHistory)),
            rpUiChat: JSON.parse(JSON.stringify(roleplayUiChat)),
            rpSystemPrompt: systemPrompt
        }, ...prev]);
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
        if (item.profile) {
            setPersonaProfile(item.profile);
            setRoleplayApiHistory(item.rpApiHistory || []);
            setRoleplayUiChat(item.rpUiChat || []);
            setSystemPrompt(item.rpSystemPrompt || '');
        }
    };

    // --- Utility ---
    const copyText = (text, id) => {
        if (!text) return;
        const ta = document.createElement("textarea");
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

    // --- Visualizer Generation Logic ---
    const executeGeneration = async (promptText, historySnapshot, options = {}) => {
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
            const imageUrl = await callImageAPI(promptText, inputImageBase64);
            setGeneratedImage(imageUrl);
            const styleForCache = options.targetStyle ?? visualStyle;
            if (styleForCache === 'photo') setGeneratedImagePhoto(imageUrl);
            else setGeneratedImage3d(imageUrl);

            const modeLabel = inputImageBase64 ? "Refined previous image" : "Generated new image";
            const finalChat = [...historyWithPrompt, { role: 'system', text: `${modeLabel} using ${selectedImageModel}.`, type: 'text' }];
            setVisChatHistory(finalChat);
            if (!options.skipAddToHistory) {
                const sH = options.targetStyle ?? visualStyle;
                addToHistory(imageUrl, promptText, finalChat, {
                    imagePhoto: sH === 'photo' ? imageUrl : generatedImagePhoto,
                    image3d: sH === '3d' ? imageUrl : generatedImage3d,
                    visualStyle: sH
                });
            }
            return imageUrl;
        } catch (err) {
            if (err.message === "SAFETY_BLOCK") {
                setIsVisSanitizing(true);
                try {
                    const payload = { contents: [{ parts: [{ text: `The following image prompt triggered a safety filter. Rewrite it to be "Safe for Work" while keeping the extreme detail.\n- Remove explicit anatomical terms.\n- Replace with artistic terms.\n- Keep the structured format.\n- Output ONLY the sanitized prompt.\n\nPROMPT TO FIX:\n"${promptText}"` }] }] };
                    const sanitizedPrompt = await callTextAPI(payload);
                    setVisChatHistory(prev => [...prev, { role: 'system', text: 'Safety filter triggered.', type: 'safety-recovery', proposedPrompt: sanitizedPrompt }]);
                } catch (sanitizeErr) {
                    setError("Safety block detected, and auto-fix failed.");
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
        setVisUserInput("");
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
                const promptContext = currentPrompt
                    ? `CURRENT PROMPT:\n"${currentPrompt}"\n\nUSER REQUEST: Change the character based on this instruction: "${modificationText}".\n\nRemember to output ONLY the updated full prompt in the structured format.`
                    : `USER REQUEST: Create a new male character description.\n\nINSTRUCTION: ${modificationText}.\n\nEnsure you use the full structured format with all sections.`;
                const payload = {
                    contents: [{ parts: [{ text: promptContext }] }],
                    systemInstruction: { parts: [{ text: DEFAULT_SYSTEM_PROMPT }] }
                };
                promptToSend = await callTextAPI(payload);
                promptToSend = applyStyleToPrompt(promptToSend, visualStyle, STYLE_SECTIONS);
                setIsVisTextLoading(false);
            }
            if (personaProfile) {
                const baseRp = generateRoleplayPrompt(personaProfile);
                const visualOverride = `\n\n[VISUAL APPEARANCE - ABSOLUTE OVERRIDE]\nYour physical appearance is strictly defined by the following visual description. If any of your base profile traits conflict with this visual description, the visual description completely overrides them.\n\n${promptToSend}`;
                setSystemPrompt(baseRp + visualOverride);
            }

            await executeGeneration(promptToSend, updatedChat);
        } catch (err) {
            setError(err.message);
            setIsVisTextLoading(false);
        }
    };

    const handleRetrySafeVis = (safePrompt) => {
        executeGeneration(safePrompt, [...visChatHistory, { role: 'user', text: "Accepted safety modification.", type: 'text' }]);
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
                return updated;
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
                    return updated;
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

    // --- Roll New Target ---
    const generateNewBase = async () => {
        setError(null);
        if (!apiKey) {
            setError("API Key Required. Please enter it in Settings.");
            setShowSettings(true);
            return;
        }

        setIsGlobalRolling(true);
        setActiveMainTab('visualizer');
        setGeneratedImage(null);
        setGeneratedImagePhoto(null);
        setGeneratedImage3d(null);
        setVisChatHistory([{ role: 'system', text: 'Rolling new target attributes...', type: 'text' }]);
        setIsVisTextLoading(true);
        setCurrentPrompt("");

        const profile = rollCharacter();
        setPersonaProfile(profile);

        setRoleplayApiHistory([]);
        setRoleplayUiChat([{
            id: Date.now(),
            role: 'system',
            text: `Target Acquired: ${profile.core_identity.first_name} (${profile.psychological_profile.dominant_vibe.split('(')[0].trim()}). They are ready to chat.`
        }]);

        const profileString = formatProfileToString(profile);
        let seedInstruction = "";
        let contextMsg = "";

        if (visUserInput.trim()) {
            contextMsg = `Rolled with guidance: "${visUserInput}"`;
            seedInstruction = `Create a unique human male character description.\n**PRIMARY DIRECTIVE:** The user specifically requested: "${visUserInput}".\nYou MUST respect this request above all else.\n**SECONDARY TRAITS:** Use the following randomly rolled attributes to fill in any gaps NOT specified by the user:\n${profileString}\nIf the user request conflicts with a rolled trait, IGNORE the rolled trait and OBEY the user.\nEnsure he is STRICTLY HUMAN. Translate explicit metrics into safe visual descriptions.\nUse the full structured output format.`;
            setVisUserInput("");
        } else {
            contextMsg = `Base identity rolled: ${profile.core_identity.first_name}`;
            seedInstruction = `Create a unique human male character description based strictly on these rolled attributes:\n${profileString}\nCombine these elements into a cohesive, physically desirable character.\nTranslate explicit metrics into safe visual equivalents.\nUse the full structured output format.`;
        }

        const payload = {
            contents: [{ parts: [{ text: seedInstruction }] }],
            systemInstruction: { parts: [{ text: DEFAULT_SYSTEM_PROMPT }] }
        };

        try {
            let newPromptText = await callTextAPI(payload);
            newPromptText = applyStyleToPrompt(newPromptText, visualStyle, STYLE_SECTIONS);

            const rpSysPrompt = generateRoleplayPrompt(profile);
            const visualOverride = `\n\n[VISUAL APPEARANCE - ABSOLUTE OVERRIDE]\nYour physical appearance is strictly defined by the following visual description. If any of your base profile traits conflict with this visual description, the visual description completely overrides them.\n\n${newPromptText}`;
            setSystemPrompt(rpSysPrompt + visualOverride);

            setIsVisTextLoading(false);
            await executeGeneration(newPromptText, [{ role: 'system', text: contextMsg, type: 'text' }]);
        } catch (err) {
            setError(err.message);
            setIsVisTextLoading(false);
        } finally {
            setIsGlobalRolling(false);
        }
    };

    // --- Roleplay Chat Handlers ---
    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => { setPendingImage(reader.result); rpInputRef.current?.focus(); };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const processModelReply = async (rawReply) => {
        let cleanHistoryText = rawReply.replace(/\[SEND_PIC:\s*(.*?)\]/gi, "*[Sent a photo]*").replace(/\[SPLIT\]/gi, "\n\n").replace(/\[DELAY:\s*\d+\s*\]/gi, "");
        setRoleplayApiHistory(prev => [...prev, { role: "model", parts: [{ text: cleanHistoryText }] }]);

        const blocks = rawReply.split(/\[SPLIT\]/i).map(b => b.trim()).filter(b => b !== "");
        for (let i = 0; i < blocks.length; i++) {
            let blockText = blocks[i];
            let delayMs = 0;
            const delayMatch = blockText.match(/\[DELAY:\s*(\d+)\s*\]/i);
            if (delayMatch) {
                delayMs = Math.min(10000, parseInt(delayMatch[1], 10) * 1000);
                blockText = blockText.replace(delayMatch[0], "").trim();
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
                blockText = blockText.replace(picMatch[0], "").trim();
            }

            if (blockText || picDesc) {
                const newMsgId = Date.now() + i;
                setRoleplayUiChat(prev => [...prev, { id: newMsgId, role: 'model', text: blockText || (picDesc ? "*[Sending a photo...]*" : "") }]);
                if (picDesc) {
                    try {
                        const styledPicDesc = applyStyleToPrompt(picDesc, visualStyle, STYLE_SECTIONS);
                        const picUrl = await callImageAPI(styledPicDesc);
                        setRoleplayUiChat(prev => prev.map(msg => msg.id === newMsgId ? { ...msg, image: picUrl, text: blockText || "*[Sent a photo]*" } : msg));
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

        setRoleplayUserInput("");
        setIsChatTyping(true);
        setError(null);

        let inlineData = null;
        let imageDisplay = pendingImage;
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

        const newUserMsg = { role: "user", parts };
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

    // --- Render ---
    return (
        <div className="flex flex-col h-screen bg-slate-900 text-slate-100 font-sans overflow-hidden relative">

            {/* Header */}
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

            {/* Settings Popout */}
            {showSettings && (
                <div className="absolute top-16 right-4 w-80 p-5 bg-slate-800 border border-slate-700 rounded-xl z-50 shadow-2xl animate-in fade-in slide-in-from-top-4">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-sm uppercase text-slate-300">Studio Options</h3>
                        <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="space-y-4">
                        {personaProfile && (
                            <div className="flex gap-2">
                                <button onClick={() => { setShowDossier(true); setShowSettings(false); }} className="flex-1 bg-indigo-600/20 border border-indigo-500/50 hover:bg-indigo-600/40 text-indigo-300 font-bold py-2.5 rounded-lg flex justify-center items-center gap-2 transition-all">
                                    <Fingerprint className="w-4 h-4" /> View Persona
                                </button>
                                <button onClick={handleExportPersona} className="bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 font-bold px-3 rounded-lg flex justify-center items-center transition-all" title="Export Persona"><FileDown className="w-4 h-4" /></button>
                            </div>
                        )}
                        <hr className="border-slate-700" />
                        <div>
                            <label className="block text-xs font-semibold text-slate-400 uppercase mb-2">Google Gemini API Key</label>
                            <input type="password" value={apiKey} onChange={(e) => updateApiKey(e.target.value)} placeholder="Paste your API key here..." className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
                            <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                                {isLoadingModels && <Loader2 className="w-3 h-3 animate-spin" />}
                                {apiKey ? "Custom Key Active. Fetching models..." : "Enter key to load models."}
                            </p>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-400 uppercase mb-2 flex items-center gap-2"><LayoutGrid className="w-3 h-3" /> Workspace Layout</label>
                            <select value={layout} onChange={(e) => { setLayout(e.target.value); localStorage.setItem('adonis_layout', e.target.value); }} className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-white outline-none">
                                <option value="chat-right">Image Left, Chat Right</option>
                                <option value="chat-left">Image Right, Chat Left</option>
                                <option value="chat-bottom">Image Top, Chat Bottom</option>
                            </select>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-semibold text-slate-400 uppercase mb-2 flex items-center gap-2"><Type className="w-3 h-3" /> Text Model</label>
                                <select value={selectedTextModel} onChange={(e) => setSelectedTextModel(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-white outline-none">
                                    {availableTextModels.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-400 uppercase mb-2 flex items-center gap-2"><ImageIcon className="w-3 h-3" /> Image Model</label>
                                <select value={selectedImageModel} onChange={(e) => setSelectedImageModel(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-white outline-none">
                                    {availableImageModels.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Dossier Modal */}
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
                            <div className="space-y-6">
                                <div className="bg-gradient-to-br from-indigo-900/40 to-slate-800/40 p-6 rounded-xl border border-indigo-500/20 text-center shadow-inner">
                                    <div className="w-20 h-20 bg-slate-800 rounded-full mx-auto mb-4 flex items-center justify-center border-2 border-indigo-500/50 shadow-lg overflow-hidden">
                                        {generatedImage ? <img src={generatedImage} className="w-full h-full object-cover rounded-full" /> : <User className="w-10 h-10 text-slate-400" />}
                                    </div>
                                    <h3 className="text-2xl font-bold text-white mb-2">{personaProfile.core_identity.first_name}</h3>
                                    <p className="text-sm font-medium text-indigo-300 mb-3">{personaProfile.psychological_profile.dominant_vibe.split('(')[0]}</p>
                                    <p className="text-xs text-slate-400 bg-black/40 inline-block px-3 py-1.5 rounded-full border border-white/5">{personaProfile.core_identity.age_bracket} &bull; {personaProfile.background_and_lifestyle.current_profession.split('/')[0]}</p>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><Heart className="w-3.5 h-3.5 text-pink-400" /> Identity & Romance</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <li><span className="text-slate-500">Orientation:</span> {personaProfile.core_identity.sexual_orientation} / {personaProfile.core_identity.romantic_orientation}</li>
                                            <li><span className="text-slate-500">Status:</span> {personaProfile.core_identity.relationship_structure}</li>
                                            <li><span className="text-slate-500">Expression:</span> {personaProfile.core_identity.masculine_expression}</li>
                                            <li><span className="text-slate-500">Attachment:</span> {personaProfile.psychological_profile.attachment_style}</li>
                                            <li><span className="text-slate-500">Love Lang:</span> {personaProfile.psychological_profile.core_love_language}</li>
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><User className="w-3.5 h-3.5 text-emerald-400" /> Physicality</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <li><span className="text-slate-500">Height:</span> {personaProfile.physique_macro.height}</li>
                                            <li><span className="text-slate-500">Body Type:</span> {personaProfile.physical_and_aesthetic.body_type}</li>
                                            <li><span className="text-slate-500">Muscle:</span> {personaProfile.physique_macro.muscle_definition}</li>
                                            <li><span className="text-slate-500">Style:</span> {personaProfile.physical_and_aesthetic.style_vibe}</li>
                                            <li><span className="text-slate-500">Grooming:</span> {personaProfile.physical_and_aesthetic.grooming_habit}</li>
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><MessageSquare className="w-3.5 h-3.5 text-blue-400" /> Chat Style</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <li><span className="text-slate-500">Habit:</span> {personaProfile.communication_style.texting_habit}</li>
                                            <li><span className="text-slate-500">Tone:</span> {personaProfile.communication_style.vocabulary_and_tone}</li>
                                            <li><span className="text-slate-500">Emojis:</span> {personaProfile.communication_style.emoji_frequency} - {personaProfile.communication_style.emoji_usage}</li>
                                            <li><span className="text-slate-500">Humor:</span> {personaProfile.communication_style.humor_style}</li>
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><Layers className="w-3.5 h-3.5 text-indigo-400" /> Background</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <li><span className="text-slate-500">Class:</span> {personaProfile.background_and_lifestyle.socioeconomic_background}</li>
                                            <li><span className="text-slate-500">Hobbies:</span> {personaProfile.background_and_lifestyle.passions_hobbies}</li>
                                            <li><span className="text-slate-500">Social Battery:</span> {personaProfile.background_and_lifestyle.social_battery}</li>
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><BookOpen className="w-3.5 h-3.5 text-amber-400" /> Lore &amp; Beliefs</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <li><span className="text-slate-500">Origin:</span> {personaProfile.lore_origins?.geographic_origin ?? '—'}</li>
                                            <li><span className="text-slate-500">Family:</span> {personaProfile.family_architecture?.structure ?? '—'}</li>
                                            <li><span className="text-slate-500">Alignment:</span> {personaProfile.psychology_and_beliefs?.beliefs_values?.moral_alignment ?? '—'}</li>
                                            <li><span className="text-slate-500">MBTI:</span> {personaProfile.psychology_and_beliefs?.personality_matrix?.myers_briggs_archetype ?? '—'}</li>
                                            <li><span className="text-slate-500">Neuro:</span> {personaProfile.psychology_and_beliefs?.mental_health_neurodivergence ?? '—'}</li>
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><Mic className="w-3.5 h-3.5 text-cyan-400" /> Voice &amp; Habits</h4>
                                        <ul className="text-xs text-slate-300 space-y-2">
                                            <li><span className="text-slate-500">Resonance:</span> {personaProfile.voice_and_speech?.vocal_resonance ?? '—'}</li>
                                            <li><span className="text-slate-500">Pattern:</span> {personaProfile.voice_and_speech?.speech_patterns ?? '—'}</li>
                                            <li><span className="text-slate-500">Accent:</span> {personaProfile.voice_and_speech?.accent_profile ?? '—'}</li>
                                            <li><span className="text-slate-500">Scent:</span> {personaProfile.micro_details?.scent_profile ?? '—'}</li>
                                            <li><span className="text-slate-500">Motor tic:</span> {personaProfile.kinematics_motor_control?.fidgets_tics ?? '—'}</li>
                                        </ul>
                                    </div>
                                    <div className="bg-slate-800/40 rounded-xl p-4 border border-slate-700/50 md:col-span-2">
                                        <h4 className="text-[11px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1.5 border-b border-slate-700/50 pb-2"><Flame className="w-3.5 h-3.5 text-orange-400" /> Intimacy Dynamics</h4>
                                        <ul className="text-xs text-slate-300 space-y-2 grid grid-cols-1 md:grid-cols-2 gap-x-4">
                                            <li><span className="text-slate-500">Dynamic:</span> {personaProfile.intimacy_dynamics.power_dynamic}</li>
                                            <li><span className="text-slate-500">Pacing:</span> {personaProfile.intimacy_dynamics.pacing}</li>
                                            <li><span className="text-slate-500">Flirting:</span> {personaProfile.intimacy_dynamics.flirting_approach}</li>
                                            <li><span className="text-slate-500">Role:</span> {personaProfile.intimacy_dynamics.role_preference}</li>
                                            <li className="md:col-span-2"><span className="text-slate-500">Kinks:</span> {personaProfile.intimacy_dynamics.kinks_interests}</li>
                                        </ul>
                                    </div>
                                    <div className="bg-red-900/10 rounded-xl p-4 border border-red-900/40 md:col-span-2">
                                        <h4 className="text-[11px] font-bold text-red-400 uppercase mb-3 flex items-center gap-1.5 border-b border-red-900/30 pb-2"><Lock className="w-3.5 h-3.5" /> Hidden Vulnerabilities</h4>
                                        <ul className="text-xs text-red-200/90 space-y-3 italic">
                                            <li><span className="text-red-400/60 not-italic font-bold block mb-0.5">Fatal Flaw</span> {personaProfile.psychological_profile.fatal_flaw}</li>
                                            <li><span className="text-red-400/60 not-italic font-bold block mb-0.5">Deepest Secret</span> {personaProfile.hidden_vulnerabilities.deepest_secret}</li>
                                            <li><span className="text-red-400/60 not-italic font-bold block mb-0.5">Soft Spot</span> {personaProfile.hidden_vulnerabilities.soft_spot}</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* History Sidebar */}
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
                                        <p className="text-[11px] text-indigo-400 truncate mb-1">{item.profile?.psychological_profile?.dominant_vibe?.split('(')[0] || ''}</p>
                                        <p className="text-[10px] text-slate-500 mt-auto">{item.timestamp}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div className={`flex flex-1 min-h-0 ${layout === 'chat-bottom' ? 'flex-col' : 'flex-row'}`}>

                {/* Image Pane */}
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
                                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
                                    <span className="bg-black/50 backdrop-blur text-slate-300 text-[10px] px-2 py-1 rounded-full border border-white/10">Editing Enabled</span>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center p-8 border-2 border-dashed border-slate-800 rounded-3xl opacity-50 select-none">
                                <User className="w-16 h-16 mx-auto mb-4 text-slate-700" />
                                <p className="text-slate-500 font-medium">{isGlobalRolling ? "Synthesizing Target..." : "Visualization Workspace"}</p>
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

                {/* Chat/Controls Pane */}
                <div className={`flex flex-col bg-slate-900 z-20 ${layout === 'chat-left' ? 'order-1' : 'order-2'} ${layout === 'chat-bottom' ? 'flex-none h-[40vh] min-h-[200px] border-t border-slate-700 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]' : `flex-none w-[40%] min-w-[280px] max-w-[500px] h-full ${layout === 'chat-left' ? 'border-r border-slate-700' : 'border-l border-slate-700'}`}`}>

                    {/* Tab Bar + Roll Target */}
                    <div className={`flex-none bg-slate-900 border-b border-slate-800 px-3 py-2.5 flex justify-between items-center z-20 shadow-sm ${layout === 'chat-bottom' ? 'border-t' : ''}`}>
                        <div className="flex bg-slate-800/80 rounded-lg p-1 border border-slate-700/50">
                            <button onClick={() => setActiveMainTab('visualizer')} className={`px-3 py-2 text-[12px] font-bold rounded-md flex items-center gap-1.5 transition-all ${activeMainTab === 'visualizer' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                                <Palette className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Visualizer</span>
                            </button>
                            <button onClick={() => setActiveMainTab('chat')} disabled={!personaProfile} className={`px-3 py-2 text-[12px] font-bold rounded-md flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${activeMainTab === 'chat' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}`}>
                                <MessageCircle className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Chat with {personaProfile?.core_identity?.first_name || 'Target'}</span>
                            </button>
                        </div>
                        <button onClick={generateNewBase} disabled={isGlobalRolling || isVisImageLoading || isVisTextLoading || isChatTyping} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-full font-bold text-sm shadow-lg shadow-emerald-900/30 transition-all transform hover:scale-105 active:scale-95">
                            {isGlobalRolling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Dices className="w-4 h-4 animate-bounce" />}
                            <span className="hidden sm:inline">Roll Target</span>
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div className="flex-1 flex flex-col relative min-h-0">

                        {/* VISUALIZER TAB */}
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
                                                            {copyFeedback[idx] ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copyFeedback[idx] ? "Copied" : "Copy"}
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
                                                <span className="text-xs font-medium">{isVisSanitizing ? "Rewriting prompt..." : isVisTextLoading ? "Refining prompt..." : `Rendering with ${selectedImageModel}...`}</span>
                                            </div>
                                        </div>
                                    )}
                                    <div ref={visChatEndRef} />
                                </div>
                                <div className="p-3.5 bg-slate-800 border-t border-slate-700 flex-none">
                                    <form onSubmit={handleVisChatSubmit} className="flex gap-2">
                                        <input type="text" value={visUserInput} onChange={(e) => setVisUserInput(e.target.value)} placeholder={generatedImage ? "Describe modification (e.g., 'Make his hair silver')" : "Type details then click Roll, or just Roll for a surprise"} className="flex-1 bg-slate-900 text-white border border-slate-600 rounded-lg px-4 py-3 focus:outline-none focus:border-indigo-500 transition-all text-sm disabled:opacity-50 shadow-inner" disabled={isVisTextLoading || isVisImageLoading || isVisSanitizing} />
                                        <button type="submit" disabled={isVisTextLoading || isVisImageLoading || isVisSanitizing || !visUserInput.trim()} className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 rounded-lg flex items-center justify-center shadow-md"><Send className="w-5 h-5" /></button>
                                    </form>
                                </div>
                            </div>
                        )}

                        {/* ROLEPLAY CHAT TAB */}
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
                                            <p className="text-[10px] text-purple-300 font-medium">{isChatTyping ? "Typing..." : "Active now"}</p>
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
                                                    <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></div>
                                                    <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></div>
                                                    <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></div>
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
                                            <input type="text" ref={rpInputRef} value={roleplayUserInput} onChange={(e) => setRoleplayUserInput(e.target.value)} placeholder={personaProfile ? "Type a message..." : "Roll target to chat"} disabled={!personaProfile || isChatTyping} className="w-full bg-slate-800 text-white border border-slate-700 rounded-full pl-12 pr-4 py-3 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all text-[15px] disabled:opacity-50 shadow-inner" />
                                        </div>
                                        <button type="submit" disabled={!personaProfile || isChatTyping || (!roleplayUserInput.trim() && !pendingImage)} className="bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white aspect-square rounded-full flex items-center justify-center px-4 shadow-md transition-colors"><Send className="w-5 h-5 ml-0.5" /></button>
                                    </form>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Full Screen Modal */}
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

// --- Bootstrap: Load data then render ---

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
