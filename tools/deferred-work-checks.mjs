import assert from 'node:assert/strict';

export function selectDeferredChecks(value = 'completeness') {
  const selected = value.split(',').map(s => s.trim());
  assert(selected.length && selected.every(Boolean), 'Deferred check selection is empty');
  for (const name of selected) assert(['completeness', 'recovery'].includes(name), 'Unknown deferred check: ' + name);
  assert.equal(new Set(selected).size, selected.length, 'Duplicate deferred check selection');
  return selected;
}

// This waits for work the page/browser actually performed. Neither loading mode
// nor decode() is changed/called while native completion is being established.
export async function waitForNaturalImageCompletion(page, label, {timeout = 10000, scope = 'all'} = {}) {
  assert(['all', 'near'].includes(scope), 'Unknown natural image observation scope: ' + scope);
  await page.waitForFunction(scope => [...document.images].filter(img => {
    if(scope === 'all') return true;
    const r = img.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom >= -innerHeight && r.top <= innerHeight * 2 && r.right > 0 && r.left < innerWidth;
  }).every(img => img.complete && img.naturalWidth > 0), scope, {timeout});
  const images = await page.evaluate(scope => [...document.images].filter(img => {
    if(scope === 'all') return true;
    const r = img.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom >= -innerHeight && r.top <= innerHeight * 2 && r.right > 0 && r.left < innerWidth;
  }).map(img => ({src: img.currentSrc || img.src, loading: img.loading, complete: img.complete, width: img.naturalWidth})), scope);
  if(scope === 'all') assert(images.length > 0, label + ': no images found; expected the newsletter cover');
  assert(images.every(img => img.complete && img.width > 0), label + ': native images incomplete: ' + JSON.stringify(images));
  return images;
}

// Observation owns no navigation callback. Read and capture the original arrival
// before the driver can issue a later section visit or prepare another reference.
export async function observeDeferredDestination(page, {label, settle, read, capture, scope = 'near'}) {
  await settle(page);
  const naturalImages = await waitForNaturalImageCompletion(page, label, {scope});
  const state = await read(page);
  const shot = await capture(page);
  return {state, shot, naturalImages, imageScope: scope};
}
