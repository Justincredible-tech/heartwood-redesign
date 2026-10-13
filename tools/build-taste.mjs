import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import CleanCSS from 'clean-css';import {minify as minifyJs} from 'terser';import {minify as minifyHtml} from 'html-minifier-terser';
import {prepareTaste} from '../source/taste/index.mjs';
import {experienceEntry} from '../source/taste/experience-entry.mjs';
import {writeOutput} from './build-output.mjs';
const hash=data=>crypto.createHash('sha256').update(data).digest('hex').slice(0,12);
export async function buildTaste({root,htmlSource,cssSource,fontCss,authoredJsPath,preloads}){
 const prepared=prepareTaste({html:htmlSource,css:cssSource}),publish=path.join(root,'publish');
 const css=new CleanCSS({level:1,rebase:false}).minify(fontCss+'\n'+cssSource+'\n'+prepared.css);if(css.errors.length)throw Error(css.errors.join('\n'));
 const js=await minifyJs(prepared.js,{ecma:2020,module:false,compress:{passes:2,unsafe:false},mangle:{toplevel:false},format:{comments:false}}),head=await minifyJs(prepared.headJs,{ecma:2020,module:false,compress:{passes:2,unsafe:false},mangle:{toplevel:false},format:{comments:false}});
 if(!js.code||!head.code)throw Error('Empty taste behavior build');
 const cssPath='css/heartwood-taste.'+hash(css.styles)+'.css',jsPath='js/heartwood-taste.'+hash(js.code)+'.js',headPath='js/heartwood-taste-head.'+hash(head.code)+'.js';
 let html=prepared.html.replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\s*/g,'').replace(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\s*/g,'')
  .replace(/<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^\"]+" rel="stylesheet">/,preloads)
  .replace('<link rel="stylesheet" href="css/heartwood-site.css">',`<link rel="stylesheet" href="../${cssPath}">`)
  .replace('<script src="js/heartwood-site.js"></script>',`<script src="../${authoredJsPath}"></script><script defer src="../${jsPath}"></script>`)
  .replace(/(["'])assets\//g,'$1../assets/').replace('</head>',`<script src="../${headPath}"></script></head>`);
 if(html.includes('fonts.googleapis.com')||!html.includes('../'+cssPath)||!html.includes('../'+authoredJsPath))throw Error('Taste source reference contract changed');
 html=await minifyHtml(html,{collapseWhitespace:true,conservativeCollapse:true,removeComments:true,removeRedundantAttributes:true,removeAttributeQuotes:true,caseSensitive:true,keepClosingSlash:true,minifyCSS:false,minifyJS:false,removeOptionalTags:false});
 const viewport=htmlSource.match(/<meta name="viewport" content="([^"]+)">/);if(!viewport)throw Error('Missing taste viewport contract');html=html.replace(/(<meta name=viewport content=")[^"]+(">)/,(_,a,b)=>a+viewport[1]+b);
 await fs.mkdir(path.join(publish,'taste'),{recursive:true});await fs.writeFile(path.join(publish,cssPath),css.styles);await fs.writeFile(path.join(publish,jsPath),js.code);await fs.writeFile(path.join(publish,headPath),head.code);await writeOutput(publish,'taste/scene.html',html);await writeOutput(publish,'taste/index.html',experienceEntry('taste',{htmlSource}));
 return {generated:['taste/index.html','taste/scene.html',cssPath,jsPath,headPath],contract:prepared.contract,limitations:prepared.limitations};
}
