import {supervisedFeatureOptions} from './supervised-build-options.mjs';
// Optional multiprocess watchdog. The ordinary npm build does not import this module.
import { realpath } from 'node:fs/promises';

import { resolve, join } from 'node:path';

import { pathToFileURL } from 'node:url';

import { parseArgs } from 'node:util';

import { runWholeBuild } from './whole-build.mjs';

import { runBoundedBuild } from './bounded-build.mjs';

try {
  const {values: values} = parseArgs({
    options: {
      exclude: {type:'string'},
      phone: {
        type: 'boolean'
      },
      out: {
        type: 'string'
      },
      help: {
        type: 'boolean'
      }
    }
  });
  const featureOptions=supervisedFeatureOptions(values,process.argv.slice(2));
  if (values.help) console.log('Usage: node tools/build-supervised.mjs [--phone [--out DIR]] [--exclude=night,phone,tree-effects,network-effects]'); else {
    if (values.out !== undefined && (!values.phone || !values.out)) throw new Error('--out requires --phone and a nonempty directory');
    const root = await realpath(resolve(import.meta.dirname, '..'));
    const out = values.phone ? resolve(values.out || join(root, 'publish/mobile')) : join(root, 'publish');
    const onStep = step => console.log('[supervised] ' + step);
    const result = values.phone ? await runBoundedBuild({
      entry: pathToFileURL(join(root, 'tools/build-mobile.mjs')).href,
      args: [ {
        out: out, ...featureOptions
      } ],
      out: out,
      projectRoot: root,
      onStep: onStep
    }) : await runWholeBuild({
      entry: pathToFileURL(join(root, 'tools/build-site.mjs')).href,
      out: out,
      projectRoot: root,
      options: featureOptions,
      onStep: onStep
    });
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error.stack || error.message);
  process.exitCode = error.exitCode || 1;
}
