// Shared by all walking paths; thresholds are fictional simulation rules.
export const immobile = c => (c.medical?.injury || 0) >= 60;
export const impaired = c => (c.medical?.injury || 0) >= 25;
export const mobilityLabel = c => immobile(c) ? 'Needs carrying' : impaired(c) ? 'Walking slowly' : 'Walking normally';
