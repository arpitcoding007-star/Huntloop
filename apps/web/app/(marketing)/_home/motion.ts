/** Read when a motion starts, so a changed system setting applies at once. */
export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
