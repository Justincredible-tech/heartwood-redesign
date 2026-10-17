import {resolveBuildFeatures} from '../source/build-features.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import CleanCSS from 'clean-css';import {minify as minifyJs} from 'terser';import {minify as minifyHtml} from 'html-minifier-terser';
import {prepareTaste} from '../source/taste/index.mjs';
import {experienceEntry} from '../source/taste/experience-entry.mjs';
import {writeOutput,ensureOutputDirectory} from './build-output.mjs';
import {grainFiles,grainRows,grainRecipeSha256} from './grain-inputs.mjs';
const hash=data=>crypto.createHash('sha256').update(data).digest('hex').slice(0,12);
export async function buildTaste({root,htmlSource,cssSource,fontCss,authoredJsPath,preloads,writer=writeOutput,exclude}){
 const features=resolveBuildFeatures(exclude);
 const publish=path.join(root,'publish');
 await ensureOutputDirectory(publish,{root,protectedPaths:['source','tools','.git','.audit','site','evidence'].map(name=>path.join(root,name))});
let nightTiles=null;
if(features.night)try{
  const provenance=JSON.parse(await fs.readFile(path.join(root,'source/assets/grain/grain-provenance.json'),'utf8'));
  if(provenance.night)nightTiles=grainFiles(grainRows(provenance.night,{flavor:'night',expectedRecipeSha256:grainRecipeSha256(cssSource,'night')}));   // canonical sorted rows + current recipe pin, never Object.values order; this reducer validates names/rows only (tile bytes are verified by build-site/build-mobile where they read them)
}catch(error){if(error.code!=='ENOENT')throw error;}
 const prepared=prepareTaste({html:htmlSource,css:cssSource,nightTiles,exclude:features.excluded});
 const css=new CleanCSS({level:1,rebase:false}).minify(fontCss+'\n'+cssSource+'\n'+prepared.css);if(css.errors.length)throw Error(css.errors.join('\n'));
 const js=prepared.js==='void 0;'?null:await minifyJs(prepared.js,{ecma:2020,module:false,compress:{passes:2,unsafe:false},mangle:{toplevel:false},format:{comments:false}}),head=await minifyJs(prepared.headJs,{ecma:2020,module:false,compress:{passes:2,unsafe:false},mangle:{toplevel:false},format:{comments:false}});
 if((js&&!js.code)||!head.code)throw Error('Empty taste behavior build');
 const cssPath='css/heartwood-taste.'+hash(css.styles)+'.css',jsPath=js?'js/heartwood-taste.'+hash(js.code)+'.js':null,headPath='js/heartwood-taste-head.'+hash(head.code)+'.js';
 let html=prepared.html.replace('<script src="js/live-photos.js"></script>', '').replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*/g,'').replace(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*/g,'')
  .replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^\"]+" rel="stylesheet">/,preloads)
  .replace('<link rel="stylesheet" href="css/heartwood-site.css">',`<link rel="stylesheet" href="../${cssPath}">`)
  .replace('<script src="js/heartwood-site.js"></script>',`<script src="../${authoredJsPath}"></script>${jsPath?`<script defer src="../${jsPath}"></script>`:''}`)
  .replace(/(["'])assets\//g,'$1../assets/').replace('</head>',`<script src="../${headPath}"></script></head>`);
 if(html.includes('fonts.googleapis.com')||!html.includes('../'+cssPath)||!html.includes('../'+authoredJsPath))throw Error('Taste source reference contract changed');
 html=await minifyHtml(html,{collapseWhitespace:true,conservativeCollapse:true,removeComments:true,removeRedundantAttributes:true,removeAttributeQuotes:true,caseSensitive:true,keepClosingSlash:true,minifyCSS:false,minifyJS:false,removeOptionalTags:false});
 const viewport=htmlSource.match(/<meta name="viewport" content="([^"]+)">/);if(!viewport)throw Error('Missing taste viewport contract');html=html.replace(/(<meta name=viewport content=")[^"]+(">)/,(_,a,b)=>a+viewport[1]+b);
 await ensureOutputDirectory(path.join(publish,'taste'));await writer(publish,cssPath,css.styles);if(jsPath)await writer(publish,jsPath,js.code);await writer(publish,headPath,head.code);await writer(publish,'taste/scene.html',html);await writer(publish,'taste/index.html',experienceEntry('taste',{htmlSource,exclude:features.excluded}));
 return {generated:['taste/index.html','taste/scene.html',cssPath,...(jsPath?[jsPath]:[]),headPath],contract:prepared.contract,limitations:prepared.limitations};
}
