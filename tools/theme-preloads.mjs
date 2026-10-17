// The authored head has already selected hwTheme. Keep the speculative parser
// from requesting the opposite grain family when an explicit query overrides OS.
export function themePreloads(day,night){
  if(typeof day!=='string'||(night!==null&&typeof night!=='string'))throw Error('Invalid grain preloads');
  if(night===null)return day;
  return `<script>document.head.insertAdjacentHTML('beforeend',document.documentElement.dataset.hwTheme==='night'?${JSON.stringify(night)}:${JSON.stringify(day)})</script><noscript>${night}</noscript>`;
}
