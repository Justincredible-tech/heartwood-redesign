// Shared unchanged reviewed encoding settings. Inert and stdlib-only.
export const ENCODE = {
  tree: {avif: 50, webp: 80}, ridges: {avif: 50, webp: 78}, clouds: {avif: 50, webp: 78}, trunk: {avif: 55, webp: 80},
  'tier-l': {avif: 56, webp: 80}, 'tier-r': {avif: 56, webp: 80}, leaves: {avif: 62, webp: 86}, ground: {avif: 55, webp: 80}, roots: {avif: 52, webp: 78},
  sky: {avif: 40, webp: 80}, walk: {avif: 62, webp: 86}, bee: {avif: 62, webp: 86}, flies: {avif: 62, webp: 86},
};
export const encodeFor = name => ENCODE[name.replace(/-night$/, '')];   // night bakes use their day piece's settings
