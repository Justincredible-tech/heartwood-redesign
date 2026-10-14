import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,rm,lstat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareTaste} from '../source/taste/index.mjs';
import {experienceEntry} from '../source/taste/experience-entry.mjs';
import {parseBuildFlags,runBuildCommand} from '../tools/build-cli.mjs';
import {isOperatingSystemMetadata,validateSiteOutput} from '../tools/build-site.mjs';

test('taste static mode link selects Day at root and nested hosting paths', async () => {
  const [html,css] = await Promise.all([
    readFile(new URL('../source/heartwood-site.html',import.meta.url),'utf8'),
    readFile(new URL('../source/css/heartwood-site.css',import.meta.url),'utf8')
  ]);
  const prepared = prepareTaste({html,css});
  const links = [...prepared.html.matchAll(/<a href="([^"<>]+)" data-hw-mode>([^<]+)<\/a>/g)];
  assert.equal(links.length,1);
  assert.equal(links[0][2],'Day');
  for (const prefix of ['/', '/heartwood/']) {
    const target = new URL(links[0][1].replace(/&amp;/g, '&'), 'https://example.invalid'+prefix+'taste/scene.html');
    assert.equal(target.pathname,prefix+'desktop-day.html');
    assert.equal(target.searchParams.get('view'),'desktop');
    assert.equal(target.searchParams.get('theme'),'light');
  }
  const fallback = experienceEntry('taste',{htmlSource:html});
  assert(fallback.includes('href="../desktop-day.html?view=desktop&amp;theme=light">Day</a>'));
  assert(!prepared.html.includes('href="taste/?theme=dark" data-hw-mode'));
});

test('known OS metadata is ignored without ignoring extra asset inputs', () => {
  for (const name of ['.DS_Store','Thumbs.db','thumbs.DB','desktop.ini']) assert.equal(isOperatingSystemMetadata(name),true);
  for (const name of ['.unexpected.webp','unreferenced.webp','.DS_Store.webp','photos-provenance.json']) assert.equal(isOperatingSystemMetadata(name),false);
});

test('ordinary build flags and deadline validation fail closed', async () => {
  assert.deepEqual(parseBuildFlags([]),{help:false});
  assert.deepEqual(parseBuildFlags(['--help']),{help:true});
  assert.throws(() => parseBuildFlags(['--unknown']),/Unknown/);
  for (const timeoutMs of [NaN,Infinity,0,-1,1.5,120001]) {
    let invoked = false;
    await assert.rejects(runBuildCommand('bad',() => {invoked=true;},{timeoutMs}),/deadline/);
    assert.equal(invoked,false);
  }
  const before = ['SIGINT','SIGTERM','SIGHUP'].map(signal => process.listenerCount(signal));
  assert.equal(await runBuildCommand('test',async () => 'result'), 'result');
  await assert.rejects(runBuildCommand('test',async () => {throw new Error('intentional failure');}),/intentional failure/);
  assert.deepEqual(['SIGINT','SIGTERM','SIGHUP'].map(signal => process.listenerCount(signal)),before);
});

test('default site admission refuses protected directories before creating anything', async () => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'heartwood-site-output-test-')));
  try {
    await mkdir(join(root,'source'));
    const blocked=join(root,'source','new-output');
    await assert.rejects(validateSiteOutput(blocked,root),/protected input/);
    await assert.rejects(lstat(blocked),{code:'ENOENT'});
    const output=await validateSiteOutput(join(root,'publish'),root);
    assert((await lstat(output)).isDirectory());
    await assert.rejects(validateSiteOutput(root,root),/protected input/);
  } finally {await rm(root,{recursive:true,force:false});}
});
