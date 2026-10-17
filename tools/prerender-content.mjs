/** Build-time content rendering using the captured site's original expressions.
 * No browser, network, external parser, or runtime dependency is required.
 * This deliberately accepts the known capture's structure, failing closed if
 * its render boundaries or empty targets change rather than guessing at HTML.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const hash = value => createHash('sha256').update(value).digest('hex');
const escape = value => String(value).replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const scripts = html => [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
function uniqueIndex(source, marker) {
  const index = source.indexOf(marker);
  assert(index !== -1 && index === source.lastIndexOf(marker), 'Expected one boundary: ' + marker);
  return index;
}
function between(source, start, end) {
  const a = uniqueIndex(source, start), b = uniqueIndex(source, end);
  assert(b > a, 'Reversed source boundaries');
  return source.slice(a, b);
}
function replaceOnce(source, before, after) {
  uniqueIndex(source, before);
  // A replacement callback is required: source contains literal $$ selectors.
  return source.replace(before, () => after);
}
function decodeText(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
    return ({amp:'&',lt:'<',gt:'>',quot:'\"',apos:"'",nbsp:'\u00a0'})[entity.toLowerCase()];
  });
}

export function prerenderContent(input) {
  const originalScripts = scripts(input);
  assert.equal(originalScripts.length, 2, 'Expected original two inline scripts');
  const code = originalScripts[1][1];
  const model = code.slice(0, uniqueIndex(code, '\n(() => {') + 1);
  const markup = input.slice(0, originalScripts[0].index);
  const ids = ['key-chips','work-cards','gather-cards','news-issue','news-posts','groups','group-tally','council-a','council-b','support-cards'];
  const nodes = new Map(ids.map(id => [id, {innerHTML:'', textContent:'', writes:0}]));
  nodes.set('dialog-content', {innerHTML:''});

  // Only properties used by the original leaf-to-record seating are modeled.
  // Layout and browser events are never executed during this build.
  const leaves = [...markup.matchAll(/<button\b[^>]*>/g)].filter(m => /\bclass="[^"]*\bleaf\b/.test(m[0])).map(m => {
    const classes = new Set(/\bclass="([^"]*)"/.exec(m[0])[1].split(/\s+/));
    const style = /\bstyle="([^"]*)"/.exec(m[0])?.[1] || '';
    return {classList:classes, dataset:{}, style:{getPropertyValue(name) {
      return new RegExp('(?:^|;)\\s*' + name + ':([^;]+)').exec(style)?.[1] || '';
    }}, attributes:{}, setAttribute(name,value){this.attributes[name]=String(value);}, removeAttribute(name){delete this.attributes[name];}};
  });
  assert(leaves.length > 0, 'No original leaf buttons found');
  const headingMatches = [...markup.matchAll(/<(h1|h2)\b([^>]*)>([^<]*)<\/\1>/g)].filter(m => !/id="dialog-title"|\bvisually-hidden\b/.test(m[2]));
  assert.equal(headingMatches.length, 7, 'Original heading structure changed');
  const headings = headingMatches.map(m => ({textContent:decodeText(m[3]), innerHTML:'', attributes:{}, setAttribute(name,value){this.attributes[name]=String(value);}}));
  const $ = selector => {
    assert(selector.startsWith('#') && nodes.has(selector.slice(1)), 'Unexpected build selector: ' + selector);
    return nodes.get(selector.slice(1));
  };
  const $$ = selector => {
    if (selector === 'button.leaf') return leaves;
    if (selector === '.hero h1, .layer h2:not(.visually-hidden)') return headings;
    throw Error('Unexpected build selector: ' + selector);
  };
  const chunks = {
    escape:between(code, '  const esc = ', '  const tree = '),
    items:between(code, '  const items = new Map();', '  /* ------------------------------------------------------ leaves <- items */'),
    seating:between(code, "  const leaves = $$('button.leaf', tree);", '  /* the leaf to fly for an item:'),
    panel:between(code, '  const mark = t =>', "  document.addEventListener('leaf:pick'"),
    chips:between(code, "  const key = $('#key-chips');", "  let chosen = 'all';"),
    sections:between(code, '  const go = it =>', "  const find = $('#group-find'), tally = $('#group-tally');"),
    council:between(code, '  const person = ([name, where, role]) =>', '  /* ------------------------------------------------- stones under the type */'),
    headings:between(code, "  $$('.hero h1, .layer h2:not(.visually-hidden)').forEach(h => {", '  /* the tree mark of each section label'),
  };
  const context = vm.createContext({ $, $$, tree:{}, exportResult:null }, {codeGeneration:{strings:false,wasm:false}});
  const buildCode = model + '\n' + Object.values(chunks).join('\n') + `
    exportResult = {records:[...items.values()], model:SITE, kinds:KINDS,
      panels:[...items.values()].map(item => {
        fill(item, leafOf.get(item.id) || leaves.find(l => l.dataset.kind === item.kind) || leaves[0]);
        return {id:item.id, html:$('#dialog-content').innerHTML};
      })};
  `;
  new vm.Script(buildCode, {filename:'original-content-build.js'}).runInContext(context, {timeout:2000});
  const result = JSON.parse(JSON.stringify(context.exportResult));
  nodes.get('group-tally').textContent = result.model.groups.length + ' member groups';

  let html = input;
  const containerEvidence = [];
  for (const id of ids) {
    const target = new RegExp('<([a-z][\\w:-]*)\\b[^>]*\\bid="' + id + '"[^>]*>\\s*</\\1>', 'g');
    const matches = [...markup.matchAll(target)];
    assert.equal(matches.length, 1, 'Expected one empty static target: ' + id);
    const original = matches[0][0];
    const value = id === 'group-tally' ? escape(nodes.get(id).textContent) : nodes.get(id).innerHTML;
    assert(value.length > 0, 'No generated markup: ' + id);
    const open = original.slice(0, original.indexOf('>') + 1), close = '</' + matches[0][1] + '>';
    html = replaceOnce(html, original, open + value + close);
    containerEvidence.push({id, bytes:Buffer.byteLength(value), sha256:hash(value)});
  }
  for (let i = 0; i < headings.length; i++) {
    const source = headingMatches[i], node = headings[i];
    assert.equal(node.attributes['aria-label'], node.textContent);
    html = replaceOnce(html, source[0], '<' + source[1] + source[2] + ' aria-label="' + escape(node.textContent) + '">' + node.innerHTML + '</' + source[1] + '>');
  }

  // Keep all interaction declarations. Remove only known initial DOM writes.
  // Leaf seating remains runtime hydration so its references/maps are original.
  let hydration = code;
  const removed = [];
  const cut = (start,end,replacement='') => {
    const original = between(hydration,start,end);
    hydration = replaceOnce(hydration,original,replacement);
    removed.push({start,sha256:hash(original),bytes:Buffer.byteLength(original)});
  };
  cut('  key.innerHTML = chips.map', "  let chosen = 'all';", '  // Canopy chips were rendered at build time.\n');
  cut("  $('#work-cards').innerHTML =", "  const find = $('#group-find'), tally = $('#group-tally');", "  // Cards, issue, posts and member list were rendered at build time.\n  const list = $('#groups');\n");
  hydration = replaceOnce(hydration,'  say(groups.length);','  // Initial group tally was rendered at build time.');
  cut('  const person = ([name, where, role]) =>', '  /* ------------------------------------------------- stones under the type */', '  // Councils and support cards were rendered at build time.\n\n');
  hydration = replaceOnce(hydration,chunks.headings,'  // Heading caps and accessible names were rendered at build time.\n\n');
  new vm.Script(hydration, {filename:'hydration.js'});
  html = replaceOnce(html, originalScripts[1][0], originalScripts[1][0].replace(code, () => hydration));

  // Full panel records remain available when JS is disabled. Reuse fill()'s
  // original body/list/tiers/links and wording. These records create no DOM
  // and fetch no images in the normal scripting-enabled page.
  const fallbackRecords = result.panels.map(({id,html:panel}) => {
    assert(/^[a-z0-9-]+$/.test(id), 'Unexpected record id');
    const titleId = 'record-title-' + id;
    panel = replaceOnce(panel, 'id="dialog-title"', 'id="' + titleId + '"');
    panel = panel.replace(/\sdata-close(?=[\s>])/g, '').replace(/loading="eager"/g, 'loading="lazy"');
    return '<article id="record-' + id + '" aria-labelledby="' + titleId + '">' + panel + '</article>';
  });
  const catalog = '<noscript id="static-records"><section class="static-records" aria-label="Heartwood information" style="position:relative;max-width:70rem;margin:2rem auto;padding:1.5rem;background:var(--paper,#faf4e5);color:var(--ink,#24321f)">' + fallbackRecords.join('\n') + '</section></noscript>\n';
  html = replaceOnce(html, '</body>', catalog + '</body>');

  // Content assertions run against every original record, including records
  // without a card/leaf and member organizations with an empty external URL.
  let linkCount = 0, imageCount = 0;
  result.records.forEach((item,i) => {
    const panel = fallbackRecords[i];
    for (const text of [item.title,...item.body,...(item.list||[])]) assert(panel.includes(escape(text)), 'Missing record text: ' + item.id);
    for (const [name,price] of item.tiers || []) {
      assert(panel.includes(escape(name)) && panel.includes(escape(price) + ' / year'), 'Missing membership tier: ' + item.id);
    }
    for (const link of item.links || []) {
      assert(panel.includes('href="' + escape(link.url) + '"') && panel.includes(escape(link.label)), 'Missing record link: ' + item.id);
      linkCount++;
    }
    if (item.img) {assert(panel.includes('alt="' + escape(item.img.alt) + '"') && panel.includes('src="' + escape(item.img.src) + '"'), 'Missing image/alt: ' + item.id); imageCount++;}
  });
  assert.equal(hydration.slice(0,hydration.indexOf('(() => {')),model,'Content model changed');
  assert.equal(scripts(html)[0][1],originalScripts[0][1],'Leaf animation code changed');
  assert.deepEqual([...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]), [...input.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]),'Original CSS changed');
  const expectedGroupIds = result.records.filter(it=>it.kind==='group').map(it=>it.id);
  assert.deepEqual([...nodes.get('groups').innerHTML.matchAll(/data-open="([^"]+)"/g)].map(m=>m[1]),expectedGroupIds,'Member order no longer matches search indexes');
  assert(!/\b(?:key|list)\.innerHTML\s*=|\$\('#(?:work-cards|gather-cards|news-issue|news-posts|council-a|council-b|support-cards)'\)\.innerHTML\s*=/.test(hydration),'Initial rendering remains');
  return {html,hydration,manifest:{inputSha256:hash(input),outputSha256:hash(html),contentModelSha256:hash(model),records:result.records.length,recordIds:result.records.map(it=>it.id),groups:expectedGroupIds.length,leaves:leaves.length,headings:headings.length,linksVerified:linkCount,imagesVerified:imageCount,containers:containerEvidence,removed,checks:{modelUnchanged:true,animationScriptUnchanged:true,stylesUnchanged:true,memberSearchOrderUnchanged:true,allRecordBodiesLinksAndImageAltsPreserved:true,scriptsCompile:true},notes:['Prerendering does not reduce the original decorative DOM or its paint complexity.','Build VM executes selected trusted local capture expressions only; it is not an untrusted-code sandbox.','Full record catalog is parsed only when scripting is disabled.']}};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const {parseToolArgs,showToolHelp}=await import('./tool-cli.mjs');
  const parsed=parseToolArgs({maxPositionals:2});showToolHelp(parsed,'Usage: node tools/prerender-content.mjs [INPUT_HTML] [OUTPUT_DIR]');
  const {ensureToolRuntime}=await import('./tool-runtime.mjs');const rt=ensureToolRuntime({name:'content prerender',runTimeoutMs:120000});await rt.ready;
  const root = resolve(import.meta.dirname,'..');
  const input = resolve(root,parsed.positionals[0] || 'site/experiments/images-proposal/index.html');
  const out = resolve(root,parsed.positionals[1] || 'site/experiments/prerender-content');
  const built = prerenderContent(await readFile(input,'utf8'));
  await mkdir(out,{recursive:true});
  await writeFile(resolve(out,'index.html'),built.html);
  await writeFile(resolve(out,'static-content.html'),built.html);
  await writeFile(resolve(root,'source/hydration.js'),built.hydration);
  await writeFile(resolve(root,'evidence/prerender-content-manifest.json'),JSON.stringify(built.manifest,null,2)+'\n');
  console.log(JSON.stringify({output:out,records:built.manifest.records,groups:built.manifest.groups,headings:built.manifest.headings,checks:built.manifest.checks}));
}
