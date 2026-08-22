/** physique_macro is source of truth; macro_physique is derived so the image model gets one silhouette. */

const HEIGHT_TO_CATEGORY = [
    { test: /under\s*5['’]4|pocket/i, value: 'Petite / Short (Under 5\'3")' },
    { test: /5['’]4|short king/i, value: 'Average height' },
    { test: /5['’]8|approachable/i, value: 'Average height' },
    { test: /5['’]11|statistically/i, value: 'Tall (5\'9" - 6\'1")' },
    { test: /6['’]1|imposing/i, value: 'Tall (5\'9" - 6\'1")' },
    { test: /6['’]4|towering|6['’]7|giant|door-ducker/i, value: 'Towering / Giant (Over 6\'2")' }
];

const RATIO_TO_FRAME = [
    { test: /pear/i, value: 'Narrow clavicles / Wide hips (Pear)' },
    { test: /barrel/i, value: 'Barrel-chested / Rib-heavy' },
    { test: /fridge|square/i, value: 'Dense / Heavy-boned' },
    { test: /rectangular/i, value: 'Rectangular / Boxy' },
    { test: /v-taper|dorito|inverted|broad shoulder/i, value: 'Wide clavicles / Narrow hips (V-Taper)' }
];

const AGE_BRACKET_TO_RANGE = [
    { test: /fresh adult|18-21/i, value: 'Early Twenties (20-24)' },
    { test: /young adult|22-25/i, value: 'Early Twenties (20-24)' },
    { test: /quarter-life|26-29/i, value: 'Late Twenties (25-29)' },
    { test: /prime|30-35/i, value: 'Early Thirties (30-34)' },
    { test: /established|36-41/i, value: 'Late Thirties (35-39)' },
    { test: /mature|42-49/i, value: 'Middle Aged (40-49)' },
    { test: /distinguished|50-59/i, value: 'Late Middle Age (50-59)' },
    { test: /silver fox|60-69/i, value: 'Senior (60-69)' },
    { test: /elder|patriarch|70/i, value: 'Elder (70+)' }
];

function firstMatch(table, text, fallback) {
    const s = text || '';
    for (const row of table) {
        if (row.test.test(s)) return row.value;
    }
    return fallback;
}

function deriveMuscleAndFat(composition, muscle) {
    const blob = `${composition || ''} ${muscle || ''}`.toLowerCase();
    let muscleMass = 'Crossfit / Athletic';
    let fatDistribution = 'Android (Upper body/Stomach)';

    if (/twink|ectomorph|string bean|swimmer|calisthenics|shredded|chiseled|greek god|otter mode|skinny-fat/.test(blob)) {
        muscleMass = /skinny-fat|natural\/soft/.test(blob) ? 'Soft / Untoned' : 'Runner\'s Build / Lean';
    } else if (/wiry|laborer/.test(blob)) {
        muscleMass = 'Wiry / Functional strength';
    } else if (/bodybuilder|mass monster|hypertrophy|greek god|chiseled/.test(blob)) {
        muscleMass = 'Bodybuilder / Hypertrophic';
    } else if (/powerlifter|bear|bulk|brawny|hulking|fridge|muscle bear/.test(blob)) {
        muscleMass = 'Powerlifter / Bear mode (Muscle under fat)';
    } else if (/athletic|fighter|mma|crossfit|mesomorph/.test(blob)) {
        muscleMass = 'Crossfit / Athletic';
    } else if (/dad bod|chub|husky|endomorph|soft/.test(blob)) {
        muscleMass = 'Soft / Untoned';
    }

    if (/shredded|paper-thin|veiny|twink|ectomorph|swimmer|calisthenics|otter mode|extremely low/.test(blob)) {
        fatDistribution = 'Extremely low body fat (Veiny/Shredded)';
    } else if (/chub|husky|obese|high body|plus/.test(blob)) {
        fatDistribution = 'High body fat (Plus size/Obese)';
    } else if (/dad bod|bear|endomorph|bulk|powerlifter|soft torso/.test(blob)) {
        fatDistribution = 'Subcutaneous dominant (Soft all over)';
    } else if (/pear/.test(blob)) {
        fatDistribution = 'Gynoid (Hips/Thighs/Butt)';
    } else if (/skinny-fat/.test(blob)) {
        fatDistribution = 'Android (Upper body/Stomach)';
    }

    return { muscleMass, fatDistribution };
}

export function reconcilePhysique(profile) {
    if (!profile) return profile;
    const pm = profile.physique_macro || {};
    const existing = profile.macro_physique || {};
    const { muscleMass, fatDistribution } = deriveMuscleAndFat(pm.body_composition, pm.muscle_definition);
    profile.macro_physique = {
        ...existing,
        height_category: firstMatch(HEIGHT_TO_CATEGORY, pm.height, existing.height_category || 'Average height'),
        skeletal_frame: firstMatch(RATIO_TO_FRAME, pm.shoulder_to_waist_ratio, existing.skeletal_frame || 'Rectangular / Boxy'),
        muscle_mass: muscleMass,
        fat_distribution: fatDistribution,
        posture: existing.posture || 'Confident / Chest out'
    };
    return profile;
}

export function reconcileAge(profile) {
    if (!profile) return profile;
    const bracket = profile.core_identity?.age_bracket;
    if (!bracket) return profile;
    if (!profile.identity_lineage) profile.identity_lineage = {};
    profile.identity_lineage.chronological_age_range = firstMatch(
        AGE_BRACKET_TO_RANGE,
        bracket,
        profile.identity_lineage.chronological_age_range || 'Early Thirties (30-34)'
    );
    return profile;
}

export function reconcileProfile(profile) {
    if (!profile) return profile;
    reconcilePhysique(profile);
    reconcileAge(profile);
    return profile;
}

export function buildPhysicalGroundTruthBlock(profile) {
    if (!profile) return '';
    const ci = profile.core_identity;
    const pa = profile.physical_and_aesthetic;
    const pm = profile.physique_macro;
    const mp = profile.macro_physique;
    const ff = profile.facial_features;
    const pmicro = profile.physique_micro;
    const md = profile.micro_details;
    const lines = [
        'CANONICAL SILHOUETTE (physique_macro is source of truth; macro_physique is derived — do not contradict)',
        `Name: ${ci?.first_name ?? '—'}`,
        `Age: ${ci?.age_bracket ?? '—'} (lineage window: ${profile.identity_lineage?.chronological_age_range ?? '—'})`,
        `Height: ${pm?.height ?? '—'} → ${mp?.height_category ?? '—'}`,
        `Composition: ${pm?.body_composition ?? '—'}`,
        `Muscle definition: ${pm?.muscle_definition ?? '—'} → muscle mass ${mp?.muscle_mass ?? '—'}`,
        `Fat distribution: ${mp?.fat_distribution ?? '—'}`,
        `Shoulder-to-waist: ${pm?.shoulder_to_waist_ratio ?? '—'} → frame ${mp?.skeletal_frame ?? '—'}`,
        `Posture: ${mp?.posture ?? '—'}`,
        `Hands/feet: ${pm?.hands_and_feet ?? '—'}`,
        `Body type (aesthetic summary): ${pa?.body_type ?? '—'}`,
        `Style / vibe: ${pa?.style_vibe ?? '—'}; Grooming: ${pa?.grooming_habit ?? '—'}`,
        `Face — jaw/chin: ${ff?.jawline_and_chin ?? '—'}; eyes: ${ff?.eye_shape_and_gaze ?? '—'}; nose: ${ff?.nose_structure ?? '—'}`
    ];
    if (pmicro) {
        lines.push(`Facial hair: ${pmicro.facial_hair_style ?? '—'}; body hair: ${pmicro.body_hair_density ?? '—'}; vascularity: ${pmicro.vascularity ?? '—'}`);
    }
    if (md) {
        lines.push(`Skin: ${md.skin_complexion ?? '—'}; markings: ${md.skin_markings ?? '—'}`);
        lines.push(`Hair: ${md.hair_texture ?? '—'} / ${md.hair_color ?? '—'} / ${md.hair_style ?? '—'}; facial hair (detail): ${md.facial_hair ?? '—'}`);
        lines.push(`Eyes: ${md.eye_shape ?? '—'} / ${md.eye_color ?? '—'}`);
    }
    return lines.join('\n');
}

export const VISUAL_TRAIT_PATHS = new Set([
    'core_identity.age_bracket',
    'core_identity.first_name',
    'physique_macro.height',
    'physique_macro.body_composition',
    'physique_macro.muscle_definition',
    'physique_macro.shoulder_to_waist_ratio',
    'physique_macro.hands_and_feet',
    'physical_and_aesthetic.body_type',
    'physical_and_aesthetic.style_vibe',
    'physical_and_aesthetic.grooming_habit',
    'facial_features.jawline_and_chin',
    'facial_features.eye_shape_and_gaze',
    'facial_features.nose_structure',
    'physique_micro.facial_hair_style',
    'physique_micro.body_hair_density',
    'physique_micro.vascularity',
    'micro_details.skin_complexion',
    'micro_details.skin_markings',
    'micro_details.hair_texture',
    'micro_details.hair_color',
    'micro_details.hair_style',
    'micro_details.facial_hair',
    'micro_details.eye_shape',
    'micro_details.eye_color',
    'macro_physique.height_category',
    'macro_physique.skeletal_frame',
    'macro_physique.muscle_mass',
    'macro_physique.fat_distribution',
    'macro_physique.posture',
    'identity_lineage.chronological_age_range'
]);
