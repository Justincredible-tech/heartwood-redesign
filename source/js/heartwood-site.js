
/* ==========================================================================
   Leaf lift: pick -> fly to the centre of the view and turn level -> one
      half-turn about its long (X) axis to show the underside -> open the
      dialog. Closing plays it back and re-seats the leaf.

      Hooks: the document fires "leaf:pick" (as a leaf leaves the tree; fill the
      dialog here), "leaf:open" and "leaf:close" with event.detail = { id, leaf },
      where id is the button's data-leaf value. window.leafLift.open(leaf, back, item)
      lifts a leaf from script.
   ========================================================================== */
(() => {
  const stage = document.getElementById('stage');
  const tree  = document.querySelector('.tree');
  const scrim = document.getElementById('scrim');
  const lift  = document.getElementById('lift');
  const sheet = document.getElementById('dialog');
  const page  = [...document.querySelectorAll('[data-page]')];   // everything behind the dialog
  const close = document.getElementById('dialog-close');

  const TIMING = { fly: 780, flip: 760, sheet: 320, home: 820 };
  const CROWN_SCALE = 0.8;                       // leaf size once it sits on the dialog
  const PERSPECTIVE = 'perspective(1100px)';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const ms = n => (reduced.matches ? 1 : n);

  let state = 'idle';                            // idle | opening | open | closing
  let active = null;

  /* Run an animation, then leave its end state on the element as inline style. */
  function play(el, frames, options) {
    const anim = el.animate(frames, { fill: 'both', easing: 'cubic-bezier(.55, 0, .2, 1)', ...options });
    return anim.finished.then(() => { anim.commitStyles(); anim.cancel(); });
  }

  /* Where a leaf is on screen right now: centre, angle and length in px. */
  function pose(leaf) {
    const box = leaf.getBoundingClientRect();
    const m = new DOMMatrixReadOnly(getComputedStyle(leaf).transform);
    return {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      angle: Math.atan2(m.b, m.a) * 180 / Math.PI,
      length: leaf.offsetHeight * Math.hypot(m.a, m.b),
    };
  }

  /* The same paper shadow the leaves wear on the tree, in px, for a leaf drawn at `scale`. */
  function shadow(lifted, scale) {
    const u = tree.clientWidth / 1508 * 3.4 / scale;     // 1508 = width of the artwork in design px
    return lifted
      ? `drop-shadow(0 0 ${0.12 * u}px rgb(10 20 12 / .3)) drop-shadow(${1.4 * u}px ${3.2 * u}px ${3.6 * u}px rgb(5 12 8 / .45))`
      : `drop-shadow(0 0 ${0.12 * u}px rgb(28 46 24 / .3)) drop-shadow(${0.35 * u}px ${0.75 * u}px ${0.8 * u}px rgb(28 46 24 / .2))`;
  }

  const viewport = () => ({ w: document.documentElement.clientWidth, h: window.innerHeight });

  /* A leaf picked from a card far down the page is a long way off screen. Start (and end) its flight
     just outside the window instead, so it drops in from the tree's direction at an even pace. */
  function near(p, vp) {
    const pad = p.length * 1.5;
    return { ...p, y: Math.max(-pad, Math.min(vp.h + pad, p.y)) };
  }

  function buildFlyer(leaf, L, W) {
    const tones = [...leaf.classList].filter(c => /^t\d$/.test(c)).join(' ');
    const fx = document.createElement('div');
    fx.className = 'flyer ' + tones;
    fx.innerHTML =
      '<div class="flyer__y"><div class="flyer__turn"><div class="flyer__spin">' +
      '<span class="leaf__face leaf__top"></span><span class="leaf__face leaf__under"></span>' +
      '</div></div></div>';
    const spin = fx.querySelector('.flyer__spin');
    Object.assign(spin.style, { width: W + 'px', height: L + 'px', left: -W / 2 + 'px', top: -L / 2 + 'px' });
    lift.appendChild(fx);
    return {
      fx, spin,
      fy: fx.querySelector('.flyer__y'),
      turn: fx.querySelector('.flyer__turn'),
      top: fx.querySelector('.leaf__top'),
      under: fx.querySelector('.leaf__under'),
    };
  }

  /* Swap which face is showing exactly as the leaf passes edge-on. */
  function swapFaces(a, toUnder, duration) {
    const [from, to] = toUnder ? [1, 0] : [0, 1];
    const keys = (x, y) => [{ opacity: x, offset: 0 }, { opacity: x, offset: .4999 }, { opacity: y, offset: .5 }, { opacity: y, offset: 1 }];
    return Promise.all([
      play(a.top, keys(from, to), { duration, easing: 'linear' }),
      play(a.under, keys(to, from), { duration, easing: 'linear' }),
    ]);
  }

  async function open(leaf, back, item) {      // back: what to give the focus back to; item: see leaf:pick
    if (state !== 'idle') return;
    state = 'opening';

    const vp = viewport();
    const from = near(pose(leaf), vp);
    const ratio = leaf.offsetWidth / leaf.offsetHeight;
    const L = Math.min(380, vp.w * 0.72, vp.h * 0.6);       // leaf length when presented
    const W = L * ratio;
    const tilt = from.angle >= 0 ? 90 : -90;                // nearest way to lie level
    const s0 = from.length / L;

    active = { leaf, back, L, W, tilt, ...buildFlyer(leaf, L, W) };
    const a = active;

    leaf.classList.add('is-away');
    document.body.style.paddingRight = window.innerWidth - document.documentElement.clientWidth + 'px';
    document.body.classList.add('is-lifted');
    page.forEach(el => { el.inert = true; });
    document.dispatchEvent(new CustomEvent('leaf:pick', { detail: { id: leaf.dataset.leaf, leaf, item } }));   // fill the dialog now

    // 1. off the tree, across to the centre of the view, turning level on the way
    await Promise.all([
      play(a.fx,
        [{ transform: `translateX(${from.x}px)` }, { transform: `translateX(${vp.w / 2}px)` }],
        { duration: ms(TIMING.fly), easing: 'cubic-bezier(.6, 0, .25, 1)' }),
      play(a.fy,
        [{ transform: `translateY(${from.y}px) scale(${s0})`, filter: shadow(false, s0) },
         { transform: `translateY(${vp.h / 2}px) scale(1)`, filter: shadow(true, 1) }],
        { duration: ms(TIMING.fly), easing: 'cubic-bezier(.3, 0, .15, 1)' }),
      play(a.spin,
        [{ transform: `rotate(${from.angle}deg)` }, { transform: `rotate(${tilt}deg)` }],
        { duration: ms(TIMING.fly) }),
    ]);

    // 2. one half-turn about the X axis, which runs along the level leaf
    await Promise.all([
      play(a.turn,
        [{ transform: `${PERSPECTIVE} rotateX(0deg)` }, { transform: `${PERSPECTIVE} rotateX(180deg)` }],
        { duration: ms(TIMING.flip), easing: 'cubic-bezier(.65, 0, .35, 1)' }),
      swapFaces(a, true, ms(TIMING.flip)),
    ]);

    // 3. the dialog opens and the leaf settles on its top edge
    sheet.style.setProperty('--crown', W * CROWN_SCALE + 'px');
    sheet.hidden = false;
    const top = sheet.getBoundingClientRect().top;
    await Promise.all([
      play(sheet,
        [{ opacity: 0, transform: 'translateY(18px) scale(.96)' }, { opacity: 1, transform: 'none' }],
        { duration: ms(TIMING.sheet), easing: 'cubic-bezier(.2, .8, .2, 1)' }),
      play(a.fy,
        [{ transform: `translateY(${vp.h / 2}px) scale(1)` }, { transform: `translateY(${top}px) scale(${CROWN_SCALE})` }],
        { duration: ms(TIMING.sheet), easing: 'cubic-bezier(.2, .8, .2, 1)' }),
    ]);

    state = 'open';
    close.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('leaf:open', { detail: { id: leaf.dataset.leaf, leaf } }));
  }

  async function shut() {
    if (state !== 'open') return;
    state = 'closing';
    const a = active;
    const vp = viewport();
    const top = sheet.getBoundingClientRect().top;

    await play(sheet,
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px) scale(.97)' }],
      { duration: ms(200), easing: 'ease-in' });
    sheet.hidden = true;
    sheet.style.opacity = sheet.style.transform = '';

    // back to where the leaf lives now (the page may have been resized meanwhile)
    const home = near(pose(a.leaf), vp);
    const s0 = home.length / a.L;
    document.body.classList.remove('is-lifted');

    await Promise.all([
      play(a.fx,
        [{ transform: `translateX(${vp.w / 2}px)` }, { transform: `translateX(${home.x}px)` }],
        { duration: ms(TIMING.home), easing: 'cubic-bezier(.5, 0, .2, 1)' }),
      play(a.fy,
        [{ transform: `translateY(${top}px) scale(${CROWN_SCALE})`, filter: shadow(true, CROWN_SCALE) },
         { transform: `translateY(${home.y}px) scale(${s0})`, filter: shadow(false, s0) }],
        { duration: ms(TIMING.home), easing: 'cubic-bezier(.7, 0, .3, 1)' }),
      play(a.spin,
        [{ transform: `rotate(${a.tilt}deg)` }, { transform: `rotate(${home.angle}deg)` }],
        { duration: ms(TIMING.home) }),
      play(a.turn,
        [{ transform: `${PERSPECTIVE} rotateX(180deg)` }, { transform: `${PERSPECTIVE} rotateX(0deg)` }],
        { duration: ms(TIMING.home * 0.7), easing: 'cubic-bezier(.65, 0, .35, 1)' }),
      swapFaces(a, false, ms(TIMING.home * 0.7)),
    ]);

    document.body.style.paddingRight = '';
    a.leaf.classList.remove('is-away');
    a.fx.remove();
    page.forEach(el => { el.inert = false; });
    (a.back || a.leaf).focus({ preventScroll: true });
    active = null;
    state = 'idle';
    document.dispatchEvent(new CustomEvent('leaf:close', { detail: { id: a.leaf.dataset.leaf, leaf: a.leaf } }));
  }

  /* Keep the leaf seated on the dialog if the window changes size while it is open. */
  function reseat() {
    if (state !== 'open') return;
    const vp = viewport();
    const top = sheet.getBoundingClientRect().top;
    active.fx.style.transform = `translateX(${vp.w / 2}px)`;
    active.fy.style.transform = `translateY(${top}px) scale(${CROWN_SCALE})`;
  }

  window.leafLift = { open, shut, busy: () => state !== 'idle' };

  tree.addEventListener('click', e => {
    const leaf = e.target.closest('button.leaf');
    if (leaf) open(leaf);
  });
  scrim.addEventListener('click', shut);
  close.addEventListener('click', shut);
  window.addEventListener('resize', reseat);
  document.addEventListener('keydown', e => {
    if (state === 'idle') return;
    if (e.key === 'Escape') shut();
    if (e.key === 'Tab') {                       // keep focus inside the dialog
      const stops = [...sheet.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.disabled);
      if (!stops.length) return e.preventDefault();
      const first = stops[0], last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!sheet.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  });
})();

/* ==========================================================================
   SITE: the content model. One entry = one leaf = one card.
   Everything below was read from heartwood.org on 9 Oct 2026 (text trimmed for
   length, wording theirs). `note` is a remark for whoever maintains the content
   about a gap in the source; it is not shown on the page.

   kind   which branch of the site it belongs to (see KINDS)
   sum    one line for cards and the hover tag
   meta   small line under the title (dates, places)
   body   paragraphs for the panel
   list   optional bullet list for the panel
   go     the words beside the leaf at the foot of the item's card
   links  buttons in the panel; the first one is the primary action
   img    optional picture, by its address on the current site; shown from
          PHOTOS below when there is a local copy, hot-linked when not
   ========================================================================== */
const ORIGIN = 'https://heartwood.org';

/* Small local copies of the full-size heartwood.org photos, written by tools/import-photos.py.
   Keyed by the original address; each entry lists [file, width in px]. */
/* photos:start */
const PHOTOS = {
  'https://heartwood.org/events/forest-council/2026-forest-council.jpg': [['assets/photos/2026-forest-council-360.b307a711df80.webp', 360], ['assets/photos/2026-forest-council-720.98f28e1744cd.webp', 720], ['assets/photos/2026-forest-council-1080.c2913f9c7efa.webp', 1080]],
  'https://heartwood.org/heartbeat/Fall-2026.jpg': [['assets/photos/fall-2026-360.918bf5353dcc.webp', 360], ['assets/photos/fall-2026-720.6a2b06b4dcd8.webp', 720], ['assets/photos/fall-2026-1080.cc690ad9e314.webp', 1080]],
};
/* photos:end */

const KINDS = {
  work:   { label: 'Our work',     section: '#work' },
  gather: { label: 'Gatherings',   section: '#gatherings' },
  news:   { label: 'News',         section: '#news' },
  about:  { label: 'About',        section: '#about' },
  act:    { label: 'Get involved', section: '#support' },
  group:  { label: 'Member group', section: '#network' },
};

const SITE = {
  snapshot: '9 October 2026',
  tagline: 'People helping people protect the places they love',

  /* ---------------------------------------------------------------- work */
  work: [
    {
      id: 'forest-watch', go: 'Stand watch with us', title: 'Forest Watch',
      sum: 'Heartwood’s oldest program: keeping watch on public lands, and acting when management harms the forest.',
      body: [
        'Forest Watch is Heartwood’s oldest program and remains at the core of Heartwood’s work. It is the act of keeping watch on public lands, most notably National Forest land, and taking action when forest management is having a negative impact on the health of the forest.',
        'On National Forest land, this has often meant waging legal battles against the Forest Service itself to hold the agency accountable to their own laws. Heartwood was a leading organization (if not the first) to publicly declare “no commercial logging on public lands.”',
      ],
      list: ['Timber sales', 'Prescribed burns', 'Herbicide applications', '“Restoration” projects'],
      links: [{ label: 'Read the Forest Watch page', url: ORIGIN + '/campaigns/forestwatch/index.html' }],
    },
    {
      id: 'forests-climate-carbon', go: 'Follow the carbon', title: 'Forests, Climate and Carbon',
      sum: 'Ties every program together around the role forests play in mitigating climate change.',
      body: [
        'Heartwood’s Forest, Climate and Carbon Campaign ties together all of our strategic programs, recognizing and promoting the role of forests in mitigating climate change.',
        'The campaign seeks to protect forests to maximize their role in carbon storage, cooling, hydrating, soil building, and weather generation. Priorities include stopping carbon withdrawals from forests and their subsurface areas and eliminating their use as incendiary fuels and carbon dioxide producers.',
      ],
      links: [{ label: 'Read the campaign page', url: ORIGIN + '/campaigns/fccc/index.html' }],
    },
    {
      id: 'oil-and-gas', go: 'See what drilling leaves behind', title: 'Oil and Gas Drilling',
      sum: 'Fracking and drilling on public forest land, from the Allegheny National Forest outward.',
      body: [
        'Natural gas is a fossil fuel that is often promoted as “cleaner” than coal, but which has its own serious environmental hazards. Fracking operations are especially prominent in Pennsylvania’s Allegheny National Forest.',
        'Oil drilling is incompatible with ecological and recreational values of forests. Many National Forests manage lands under split estate ownership, where the agency owns the surface but business interests own the subsurface mineral rights.',
      ],
      links: [{ label: 'Read the campaign page', url: ORIGIN + '/campaigns/oilgas/index.html' }],
    },
    {
      id: 'biomass', go: 'Why burning forests is not green', title: 'Biomass Incineration',
      sum: 'Often touted as “green” energy. Heartwood calls burning forests for power a false solution.',
      body: [
        'Heartwood has played an integral role in the creation of the Anti-Biomass Incineration & Forest Protection Campaign. The campaign has united organizations and activists across the nation in a declaration of opposition to biomass incineration.',
        'The incineration of trees and forest resources is currently, and projected to be, the largest source of biomass energy in the United States. The burning of forests for energy is not only short sighted, it is not “carbon neutral.”',
      ],
      links: [
        { label: 'Read the campaign page', url: ORIGIN + '/campaigns/biomass/index.html' },
        { label: 'Energy Justice Network on biomass', url: 'http://www.energyjustice.net/biomass' },
      ],
    },
    {
      id: 'sustainable-communities', go: 'Meet the projects', title: 'Sustainable Communities',
      sum: 'Support for projects that help communities live in ways that sustain the planet.',
      body: [
        'Heartwood is made up of people who have a deep commitment to healthy communities of people, as well as healthy forests and ecosystems. Heartwood supports projects that increase the ability of communities to function in ways that are sustainable and life promoting to the planet.',
        'A 2011 mini-grant was awarded to a project whose goal was to build a greenhouse to grow food for a local food pantry. A 2012 mini-grant went to support the creation of a resource center for citizens of a town being affected by mountaintop removal coal mining.',
      ],
      links: [{ label: 'Read the campaign page', url: ORIGIN + '/campaigns/sustainable/index.html' }],
    },
    {
      id: 'mountaintop-removal', go: 'See what is at stake', title: 'Mountaintop Removal Coal Mining',
      sum: 'Mining that turns some of the world’s most diverse temperate forests into barren ground.',
      body: [
        'Mountaintop removal, also referred to as valley fill coal mining, has become so widespread that it could now be more accurately described as mountain range removal coal mining.',
        'The process of blowing up mountains and digging for coal from the top down results in total destruction of ecosystems and transforms some of the most biologically diverse temperate forests in the world into biologically barren wastelands.',
      ],
      links: [{ label: 'Read the campaign page', url: ORIGIN + '/campaigns/mountaintop/index.html' }],
    },
    {
      id: 'mini-grants', go: 'How the grants work', title: 'Mini-grants',
      sum: 'Up to $500 for grassroots groups who might not qualify for conventional grants.',
      body: [
        'Our Minigrants program is our way of directly supporting those grassroots groups who might not otherwise qualify for conventional grants. New organizations that need some seed money to get started, small projects that need a few bucks to make it a reality – these are the kinds of grassroots efforts that we like to fund.',
        'You must be a member or member-group in good standing to apply. Applications of up to $500 will be considered.',
      ],
      list: ['Educate the Heartwood region about an environmental threat or opportunity', 'Take action to protect, restore or create environmental integrity', 'Build just and sustainable communities'],
      links: [{ label: 'Read the mini-grants page', url: ORIGIN + '/minigrants/index.html' }],
      note: 'The newest grant cycle on the current site is 2021 (deadline 21 June 2021) and its application form still says “coming soon”. Needs current dates from the client.',
    },
  ],

  /* -------------------------------------------------------------- gather */
  gather: [
    {
      id: 'forest-council', go: 'Plan for spring', title: 'Heartwood Forest Council',
      sum: 'Three days each spring, hosted by a different member group in its home bioregion.',
      meta: 'Every spring · Memorial Day weekend · 34th annual held in 2026',
      body: [
        'Every year since the spring of 1991, the Forest Council has been held over the three-day Memorial Day holiday weekend in late May.',
        'A different Member Group hosts this event in their home bioregion, and the format and agenda of the weekend is designed to bring the attention and support of the Heartwood community to bear on locally significant issues.',
      ],
      img: { src: ORIGIN + '/events/forest-council/2026-forest-council.jpg', alt: 'Poster for the 2026 Heartwood Forest Council' },
      links: [{ label: 'Forest Council page', url: ORIGIN + '/events/forest-council/' }],
      note: 'On the current site the 2026 details exist only inside the poster image, so there is no date, place or host as text. Next spring’s host is not posted.',
    },
    {
      id: 'reunion', go: 'Come to the farm', title: 'Heartwood Reunion',
      sum: 'Each fall at the Lazy Black Bear, the farm where Heartwood began around a dinner table.',
      meta: 'Every fall · The Lazy Black Bear, Hoosier National Forest, southern Indiana',
      body: [
        'The first Heartwood Reunion was held in the fall of 1995, and has been held every year since at the Lazy Black Bear, a privately owned farm surrounded by the Hoosier National Forest in southern Indiana where Heartwood first began as a discussion around a dinner table one winter night.',
        'Each year in the fall we gather at the farm where Heartwood was founded, to celebrate the grassroots forest movement and plan for the year ahead.',
      ],
      list: ['Full weekend $100, includes meals and camping (bring your own gear)', 'Friday dinner and a show $30', 'Sunday daytime free', 'Work trade available to defray registration'],
      links: [{ label: 'Reunion page', url: ORIGIN + '/events/reunion/index.html' }],
      note: 'Prices and the newest dates on the current site are from the 2025 Reunion (3–5 October 2025). 2026 dates are not posted.',
    },
  ],

  /* ---------------------------------------------------------------- news */
  news: [
    {
      id: 'heartbeat-fall-2026', title: 'Fall Heartbeat is out', date: 'Fall 2026',
      sum: 'The latest issue of Heartbeat, the twice-yearly newsletter of the Heartwood community.',
      body: [
        'Heartbeat is the biannual newsletter of the Heartwood community, with a Spring and a Fall issue timed to coincide with our two annual Events. Circulation is distributed throughout the Heartwood region and to all our Member Groups.',
        'Read the PDF, or become a member to receive print versions.',
      ],
      img: { src: ORIGIN + '/heartbeat/Fall-2026.jpg', alt: 'Cover of the Fall 2026 issue of Heartbeat' },
      links: [
        { label: 'Read Fall 2026 (PDF)', url: ORIGIN + '/heartbeat/Fall-2026.pdf' },
        { label: 'All issues', url: ORIGIN + '/heartbeat/' },
      ],
    },
    {
      id: 'nepa-analysis', title: 'Analysis of the new rule implementing the National Environmental Policy Act', date: 'September 2024',
      sum: 'A thorough analysis of a very important legal document, by Rocky Smith.',
      body: ['Read this thorough analysis of this very important legal document by Rocky Smith.'],
      links: [{ label: 'Read the analysis', url: ORIGIN + '/2024/9/NEPA/' }],
    },
    {
      id: 'old-growth', title: 'Call to action: save our mature and old-growth forests', date: 'July 2024',
      sum: 'A second chance at a once-in-a-lifetime opportunity to protect the last remaining old growth.',
      body: [
        'The public has a second chance at a once-in-a-lifetime opportunity to protect our last remaining old-growth forests. On June 21, 2024, the US Forest Service published a Draft Environmental Impact Statement, a study of five alternatives for implementing Executive Order 14072.',
        'More than half a million Americans participated in the first round of public comments. In this second opportunity we hope to see half a million new voices calling for genuine protections.',
      ],
      links: [{ label: 'Read the post', url: ORIGIN + '/2024/7/old-growth/' }],
      note: 'The comment period this post asks people to join closed on 20 September 2024. It is still the newest campaign post on the site.',
    },
    {
      id: 'forest-council-video', title: 'Eastern U.S. Forests & Heartwood Forest Council', date: 'March 2024',
      sum: 'A video interview with Matt Peters of Heartwood, on YouTube.',
      body: ['Watch this new video on YouTube: Eastern U.S. Forests & Heartwood Forest Council, a video interview with Matt Peters of Heartwood.'],
      links: [{ label: 'Go to the post', url: ORIGIN + '/2024/3/video/' }],
    },
    {
      id: 'shawnee-showdown', title: 'Documentary spotlights historic defense of Shawnee National Forest', date: 'October 2021',
      sum: 'Shawnee Showdown: Keep the Forest Standing, a film by Cade Bursell.',
      body: [
        'Cade Bursell, a professor of cinema and photography at Southern Illinois University Carbondale, announced her new documentary, Shawnee Showdown: Keep the Forest Standing.',
        'The film documents the struggle by environmentalists that won a prohibition on logging, and oil and gas drilling in 1996 that stood until 2013.',
      ],
      links: [{ label: 'Read the post', url: ORIGIN + '/2021/10/' }],
    },
    {
      id: 'podcast', title: 'Heartwood Forest Protection Podcast', date: 'Listen free',
      sum: 'Conversations with people who have dedicated their lives to protecting forests.',
      body: ['The Heartwood Forest Protection Podcast is a place where we talk with people who have dedicated their lives to protecting forests. You will learn about current threats to our forests, what you can do to make a difference, and about the lives of people who make up the forest protection movement in the United States.'],
      links: [
        { label: 'Listen (audio)', url: 'https://rss.com/podcasts/heartwood/' },
        { label: 'YouTube', url: 'https://www.youtube.com/@HeartwoodPodcast' },
        { label: 'Apple Podcasts', url: 'https://podcasts.apple.com/us/podcast/heartwood-forest-protection-podcast/id1837067094' },
        { label: 'Spotify', url: 'https://open.spotify.com/show/1ZVq6OF6HgVPWSp3t8dbMz' },
        { label: 'Amazon Music', url: 'https://music.amazon.com/podcasts/da0f038e-4eaf-4d58-bd3f-db6159bc1565/heartwood-forest-protection-podcast' },
      ],
    },
    ...[
      ['Spring 2026', 'HBeat-Spring-2026.pdf'],
      ['Fall 2025', 'HBeat-Fall-2025.pdf'],
      ['Spring 2025', 'HBeat-Spring-2025.pdf'],
      ['Fall 2024', 'HBeat-Fall-2024.pdf'],
      ['Spring 2024', 'HBeat-Spring-2024.pdf'],
    ].map(([season, file]) => ({
      id: 'heartbeat-' + season.toLowerCase().replace(' ', '-'), title: 'Heartbeat, ' + season, date: season, backIssue: true,
      sum: 'A back issue of Heartbeat, the newsletter of the Heartwood community.',
      body: ['Heartbeat is the biannual newsletter of the Heartwood community, with a Spring and a Fall issue timed to coincide with our two annual Events.'],
      links: [{ label: 'Read ' + season + ' (PDF)', url: ORIGIN + '/heartbeat/' + file }, { label: 'All issues', url: ORIGIN + '/heartbeat/' }],
    })),
  ],

  /* --------------------------------------------------------------- about */
  about: [
    {
      id: 'our-story', title: 'Our story',
      sum: 'Founded in 1991 by citizens from several midwestern states, each defending their national forest.',
      body: [
        'Heartwood was founded in 1991, when concerned citizens from several midwestern states each defending their national forest from logging, mining, roads and ruin, met and began to work together to protect the heartland hardwood forest.',
        'Eastern North America was once blanketed with a majestic hardwood forest containing more than 120 species of hardwood trees. Much of this forest has been cleared and what remains is mostly isolated fragments of public land. Heartwood is founded on a shared vision of forest restoration and ecological integrity.',
      ],
      links: [{ label: 'About Heartwood', url: ORIGIN + '/about/index.html' }],
    },
    {
      id: 'region', title: 'The Heartwood region',
      sum: 'Eighteen states, from the Ozarks to the Appalachians.',
      body: ['Over time, Heartwood has grown to include an 18-state region, including Michigan, Mississippi, Pennsylvania, Arkansas, West Virginia, North Carolina and Virginia. From the Ozarks to the Appalachians, the Ohio River basin and the Cumberland Plateau, the Heartwood region encompasses tremendous natural beauty and ecological diversity.'],
      links: [{ label: 'About Heartwood', url: ORIGIN + '/about/index.html' }],
      note: 'The current site names only seven of the eighteen states. A map would want the full list from the client.',
    },
    {
      id: 'council', title: 'Our Council',
      sum: 'The volunteers who direct, advise, inspire, inform and do the work of Heartwood.',
      body: [
        'The Heartwood Council are volunteers who direct, advise, inspire, inform and do the work of Heartwood. We are representatives of our individual bioregions and communities. We are representatives of small, grassroots groups. We are community leaders and network organizers. We are activists.',
        'Heartwood invites our members to volunteer on one of our Council Committees, and welcomes nominations to the Council.',
      ],
      links: [{ label: 'Meet the Council', url: ORIGIN + '/about/council/index.html' }],
    },
    {
      id: 'safer-spaces', title: 'Safer Spaces',
      sum: 'The protocols Heartwood has adopted for all of its events.',
      body: ['Heartwood strives to adhere to the principles of inclusiveness and consensus as outlined in the Jemez Principles, and has adopted these Safer Spaces protocols for all of our events.'],
      links: [
        { label: 'Safer Spaces protocols', url: ORIGIN + '/safer-spaces/index.html' },
        { label: 'The Jemez Principles', url: 'http://www.h-o-m-e.org/cultural-awareness/jemez-principles.html' },
      ],
    },
    {
      id: 'brochure', title: 'Brochure',
      sum: 'Heartwood in a few pages, to print and pass along.',
      body: ['The Heartwood brochure, from the About section of the current site.'],
      links: [{ label: 'Open the brochure page', url: ORIGIN + '/about/broch/index.html' }],
      note: 'Placeholder line. I did not read this page’s contents, so the panel only links to it.',
    },
  ],

  /* ----------------------------------------------------------------- act */
  act: [
    {
      id: 'donate', go: 'Give to the forest', title: 'Donate',
      sum: 'One time or monthly. Your donation also funds the Minigrant program.',
      body: [
        'For 30 years, Heartwood has been working to protect National Forests and natural communities, stretching from the central hardwood forests, through the Appalachians and in eastern and southern forests.',
        'Your donation to Heartwood helps us create a positive future for our forests and the communities they sustain.',
      ],
      list: ['One-time donation, by PayPal or Stripe', 'Monthly donation: $10, $15, $20, $25, $30, $40 or $50'],
      links: [{ label: 'Donate', url: ORIGIN + '/support/donate/index.html' }],
    },
    {
      id: 'membership', go: 'Choose your membership', title: 'Become a member',
      sum: 'Individual membership starts at $25 a year and brings Heartbeat to your mailbox.',
      body: ['Heartwood is the only organization that links together grassroots organizations, providing strategic support in both local and regional battles to protect natural and cultural heritage. There is nothing else like Heartwood.'],
      tiers: [['Individual', '$25'], ['Family', '$50'], ['Frontline Organizations', '$100'], ['Ecosystem Patron', '$500'], ['Tree Hugger Extraordinaire', '$1,000']],
      links: [{ label: 'Join Heartwood', url: ORIGIN + '/support/individual/index.html' }],
    },
    {
      id: 'group-membership', go: 'Bring your group in', title: 'Join as a group',
      sum: 'For frontline, grassroots groups working to protect the places they love.',
      body: ['Are you a frontline, grassroots group working to protect the places you love? Let us know. We want to help you join Heartwood. Send us an email for more information, or to renew your group membership.'],
      links: [
        { label: 'Email info@heartwood.org', url: 'mailto:info@heartwood.org?subject=Group%20membership' },
        { label: 'Group membership page', url: ORIGIN + '/support/group/index.html' },
      ],
    },
    {
      id: 'volunteer', go: 'Lend a hand', title: 'Volunteer',
      sum: 'Join a Council committee, or trade work for registration at a gathering.',
      body: [
        'Heartwood invites our members to volunteer on one of our Council Committees, such as the Newsletter Committee or the Minigrants Committee.',
        'Heartwood invites volunteers to help with the many aspects of event logistics, from washing dishes to adulting the kids’ activities. There is always work trade available to defray registration costs.',
      ],
      list: ['Events', 'Newsletter / Publications', 'Minigrants', 'Fundraising', 'Membership', 'Campaigns'],
      links: [{ label: 'Email info@heartwood.org', url: 'mailto:info@heartwood.org?subject=Volunteering' }],
      note: 'The Volunteer page on the current site is empty. This text is assembled from the Council and Events pages.',
    },
    {
      id: 'write-for-heartbeat', go: 'Send us your story', title: 'Write for Heartbeat',
      sum: 'Send campaign updates, campfire yarns, poetry, art, photos, rants or recipes.',
      body: ['We welcome your volunteer contributions! Send your campaign updates, campfire yarns, socio-political insights, poetry, art, photos, rants or recipes to our Editorial Committee for consideration.'],
      list: ['Spring issue deadline: January 30', 'Fall issue deadline: August 6'],
      links: [{ label: 'Email the Editorial Committee', url: 'mailto:info@heartwood.org?subject=Heartbeat%20submission' }],
    },
  ],

  /* --------------------------------------------------------------- group */
  /* Member organizations, as listed. Where the current site's link was a broken relative link
     (heartwood.org/www.example.org) the outside address has been restored; none were checked. */
  groups: [
    ['Adirondack Mountain Club'], ['Allegheny Defense Project', 'http://alleghenydefense.org'], ['Alliance for Appalachia'],
    ['Appalachia – Science in the Public Interest', 'http://a-spi.org'], ['Appalachia Resist!'], ['Appalachia Rising'],
    ['Appalachian Center for Economy and Environment'], ['Appalachian Citizen’s Law Center'], ['Appalachian Faith and Ecology Center'],
    ['Appalachian Peace Education Center'], ['Appalachian Voices'], ['Aurora Lights', 'http://auroralights.org/'],
    ['Bernie’s Custom Printing', 'http://www.bcprinting.net'], ['Bloomingfoods'], ['Bloomington Cooperative Plots', 'http://btowncooperativeplots.dwiel.net/'],
    ['Bluegrass Group Sierra Club'], ['Buckeye Environmental Network', 'https://benohio.org'], ['Center for Sustainable Living, Inc'],
    ['Citizens Coal Council'], ['Coal River Mountain Watch'], ['Concept Zero'], ['Concerned Citizens of Crawford County'],
    ['Concerned Citizens of Perry County'], ['Concerned Citizens of Scott County', 'http://www.scottsburgbiomass.com'],
    ['Dogwood Alliance', 'http://www.dogwoodalliance.org/'], ['Earthjustice'], ['East End Food Co-op'], ['ECCO, Ecological Consultants Company'],
    ['EcoWatch'], ['Energy Justice Network'], ['Friends of Bellsmith Springs'], ['Friends of Blackwater', 'http://www.saveblackwater.org'],
    ['Friends of Holly Springs'], ['Global Justice Ecology Project'], ['Hoosier Environmental Council', 'http://www.hecweb.org'],
    ['Hoosier Hikers Council', 'http://www.hoosierhikerscouncil.org'], ['Indiana Forest Alliance'], ['Indiana Lincoln Battalion for the Public Trust'],
    ['Jackson Purchase Audubon Society'], ['Keepers of the Mountains'], ['Kentuckians for the Commonwealth'], ['Kentucky Coalition'],
    ['Kentucky Coalition Appalachian Mountaintop Removal Alliance'], ['Kentucky Heartwood', 'http://www.kyheartwood.org/'], ['Kentucky Resources Council'],
    ['Marcellus Protest'], ['Mayflower Farm'], ['Meadowview Farmers Guild and Harvest Table Restaurant'], ['Mountain Heritage Alliance'],
    ['Mountain Justice'], ['Mountain Watch'], ['Murray Audubon Society'], ['Murray Environmental Student Society', 'http://campus.murraystate.edu/org/mess/'],
    ['NacreData L.L.C.', 'http://www.nacredata.com/'], ['Native Forest Network'], ['Neighborhood Co-op Grocery', 'http://www.neighborhood.coop/'],
    ['Newton County Wildlife Association (NCWA)'], ['Northside Greenspace, Inc.'], ['Ohio Environmental Council'],
    ['Ohio Valley Environmental Coalition', 'http://www.ohvec.org/'], ['Peace Coalition of Southern Illinois', 'http://www.sipeace.org/www/'],
    ['PeakChoice.org'], ['Prairie Rivers Network', 'http://www.prairierivers.org'], ['Protect Arkansas Wildlife'], ['Protect Biodiversity in Public Forests'],
    ['Public Employees for Environmental Responsibility'], ['RACE'], ['Rainforest Action Network'], ['Save America’s Forests', 'http://www.saveamericasforests.org/'],
    ['Shagbark'], ['Shawnee Green Party', 'http://www.shawneegreenparty.org'], ['Sierra Club Allegheny Group'], ['Sierra Club, Cherokee Group'],
    ['Sierra Club, Moshannon Group'], ['Southern Appalachian Forest Coalition'], ['Southern Appalachian Mountain Stewards'],
    ['Southern Environmental Law Center', 'http://southernenvironment.org'], ['Southwest Ohio Green PAC'], ['SouthWings', 'http://www.southwings.org'],
    ['Starla Medina Scholarship Fund'], ['Statewide Organizing for Community Empowerment'], ['Stop GE Trees Campaign'],
    ['Tennessee Heartwood', 'http://www.tennesseeheartwood.org'], ['Tennessee Sierra Club'], ['The Clinch Coalition'], ['The Cumberland Chapter Sierra Club'],
    ['The Permaculture Activist'], ['The Wilderness Society', 'http://www.wilderness.org'], ['The Writing Corner', 'http://bethwellington.blogspot.com/'],
    ['Third Sun Solar & Wind Power, Ltd.', 'http://www.third-sun.com'], ['Town Square Market', 'http://www.townsquaremarket.com/'], ['Tree Pittsburgh'],
    ['United Mountain Defense'], ['Urban Wildlife Coalition', 'http://urbanwildlifecoalition.org'], ['Valley Watch'], ['Virginia Forest Watch (VAFW)'],
    ['Virginia Organizing Project'], ['Voices for the Forest'], ['West Virginia Environmental Council', 'http://www.wvecouncil.org'],
    ['West Virginia Highlands Conservancy'], ['Western North Carolina Alliance'], ['Whitewater Valley Land Trust'], ['Whole Theatre', 'http://www.wholetheatre.org'],
    ['Wild South'], ['Wild Virginia', 'http://www.wildvirginia.org'], ['WildLaw'],
  ],

  /* ------------------------------------------------------------- council */
  council: {
    coordinating: [
      ['Christy Collins', 'Kentucky'], ['Lora Kemp', 'Indiana'], ['Corina Lang', 'Illinois'], ['David Nickell', 'Kentucky', 'Chair'],
      ['Matt Peters', 'Pennsylvania'], ['Don Scheiber', 'Indiana'], ['Rae Schnapp', 'Indiana'], ['Roberta Schoneman', 'Indiana'],
      ['Steven Stewart', 'Indiana'], ['Helen Vasquez', 'Indiana', 'Treasurer'], ['John Wallace', 'Illinois'],
    ],
    extended: [
      ['Jillian Borchard', 'Maryland'], ['Mark Donham', 'Illinois'], ['David Haberman', 'Indiana'],
      ['Michael Hendrix', 'Eastern Kentucky'], ['Kris Lasher', 'Indiana'], ['Sam Stearns', 'Illinois'],
    ],
  },
};

/* ==========================================================================
   Mapping the content onto the tree, and drawing the sections from the same
   list, so a leaf and its card can never disagree.

   Which leaf gets what is decided by the leaf's paper tone, so the artwork
   keeps its colours exactly as drawn:
     t6 gold          -> SITE.act, repeated around the crown
     t5 bright green  -> work, gatherings, news, about, left to right
     t1..t4           -> member groups, in list order
   Anything that does not fit on a leaf still appears in its section below.
   A leaf left with nothing becomes plain foliage.
   ========================================================================== */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const livePhotos = HeartwoodPhotos.create();
  // Responsive initial/offline copies; the original publisher URL stays authoritative.
  const photo = (img, size) => {
    const copies = PHOTOS[img.src];
    const base = new URL(document.documentElement.dataset.hwExperience === 'taste' ? '../' : './', location.href);
    const local = file => new URL(file, base).href;
    const src = copies ? `src="${esc(local(copies[Math.min(1, copies.length - 1)][0]))}" srcset="${esc(copies.map(([file, w]) => `${local(file)} ${w}w`).join(', '))}" sizes="${size}"`
                       : `src="${esc(img.src)}"`;
    return `<img ${src} data-live-photo="${esc(img.src)}" alt="${esc(img.alt)}" loading="lazy" decoding="async">`;
  };
  const tree = $('.tree');
  const tag = $('#leaftag');

  /* ------------------------------------------------------------ the items */
  const items = new Map();                       // id -> item
  const add = (kind, list) => list.map(it => { it.kind = kind; items.set(it.id, it); return it; });
  const work = add('work', SITE.work), gather = add('gather', SITE.gather), news = add('news', SITE.news),
        about = add('about', SITE.about), act = add('act', SITE.act);
  const groups = add('group', SITE.groups.map(([title, url]) => ({
    id: 'group-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    title, url,
    sum: 'Member organization',
    body: ['One of the ' + SITE.groups.length + ' member organizations in the Heartwood network. Your support of Heartwood supports the work of all these organizations, from our MiniGrants Program to the action alerts we share through our networks.'],
    links: url ? [{ label: 'Visit their site', url }] : [],
  })));

  /* ------------------------------------------------------ leaves <- items */
  const leaves = $$('button.leaf', tree);
  const tone = l => [...l.classList].find(c => /^t\d$/.test(c)) || 't5';
  const xOf = l => parseFloat(l.style.getPropertyValue('--x'));
  const TONE_HEX = { t1: '#3f6b3f', t2: '#56894f', t3: '#72a35f', t4: '#9bb45c', t5: '#b9d482', t6: '#ecd24a' };
  const KIND_TONE = { work: 't5', gather: 't5', news: 't5', about: 't5', act: 't6', group: 't2' };

  const goldLeaves = leaves.filter(l => tone(l) === 't6');
  const brightLeaves = leaves.filter(l => tone(l) === 't5').sort((a, b) => xOf(a) - xOf(b));
  const deepLeaves = leaves.filter(l => !/t[56]/.test(tone(l)));

  const leafOf = new Map();                      // item id -> its (first) leaf
  function seat(leaf, item, tabbable) {
    leaf.dataset.item = item.id;
    leaf.dataset.kind = item.kind;
    leaf.setAttribute('aria-label', KINDS[item.kind].label + ': ' + item.title);
    if (!tabbable) leaf.tabIndex = -1;           // still clickable; reachable by keyboard from its section instead
    if (!leafOf.has(item.id)) leafOf.set(item.id, leaf);
  }
  const features = [...work, ...gather, ...news, ...about];
  const spill = features.slice(brightLeaves.length);             // features with no bright leaf left take deep ones
  brightLeaves.forEach((l, i) => features[i] && seat(l, features[i], true));
  goldLeaves.forEach((l, i) => act.length && seat(l, act[i % act.length], i < act.length));
  [...spill, ...groups].slice(0, deepLeaves.length).forEach((it, i) => seat(deepLeaves[i], it, it.kind !== 'group'));
  leaves.filter(l => !l.dataset.item).forEach(l => {             // nothing left to hang here
    l.classList.add('is-plain'); l.tabIndex = -1; l.setAttribute('aria-hidden', 'true'); l.removeAttribute('aria-label');
  });

  /* the leaf to fly for an item: its own, or any leaf of its kind, or any leaf at all */
  const leafFor = id => leafOf.get(id) || leaves.find(l => l.dataset.kind === items.get(id).kind) || leaves[0];

  /* ------------------------------------------------------------ the panel */
  const dlg = $('#dialog');
  const mark = t => `<span class="leafmark ${t}"></span>`;
  function link(l, i) {
    const out = /^https?:/.test(l.url) ? ' target="_blank" rel="noopener"' : '';
    return `<a class="btn ${i ? 'btn--quiet' : 'btn--ink'}" href="${esc(l.url)}"${out}>${esc(l.label)}${i ? '' : ' <svg class="ico" aria-hidden="true"><use href="#leaf-o"/></svg>'}</a>`;
  }
  function fill(item, leaf) {
    const k = KINDS[item.kind];
    const meta = item.meta || item.date;
    $('#dialog-content').innerHTML =
      `<p class="dialog__kind">${mark(tone(leaf))}${esc(k.label)}</p>` +
      `<h2 id="dialog-title">${esc(item.title)}</h2>` +
      (meta ? `<p class="dialog__meta">${esc(meta)}</p>` : '') +
      `<div class="dialog__body">` +
        (item.img ? `<figure>${photo(item.img, '15rem')}</figure>` : '') +
        item.body.map(p => `<p>${esc(p)}</p>`).join('') +
        (item.list ? `<ul class="dots">${item.list.map(t => `<li>${mark(tone(leaf))}<span>${esc(t)}</span></li>`).join('')}</ul>` : '') +
        (item.tiers ? `<ul class="tiers">${item.tiers.map(([n, p]) => `<li><span>${esc(n)}</span><b>${esc(p)} / year</b></li>`).join('')}</ul>` : '') +
      `</div>` +
      `<div class="dialog__links">${(item.links || []).map(link).join('')}</div>` +
      `<p class="dialog__more"><a href="${k.section}" data-close>See everything under ${esc(k.label.toLowerCase())}</a></p>`;
    livePhotos.watch($('#dialog-content'));
  }
  document.addEventListener('leaf:pick', e => {     // e.detail.item is set when a card asks for an item its leaf does not carry
    const item = e.detail.item || items.get(e.detail.leaf.dataset.item);
    if (item) { fill(item, e.detail.leaf); history.replaceState(null, '', '#leaf-' + item.id); }
    hideTag();
  });
  document.addEventListener('leaf:close', () => { if (location.hash.startsWith('#leaf-')) history.replaceState(null, '', location.pathname + location.search); });
  dlg.addEventListener('click', e => { if (e.target.closest('[data-close]')) leafLift.shut(); });

  /* open an item from anywhere on the page: its leaf comes down from the tree to wherever you are */
  function openItem(id, from) {
    if (!items.has(id)) return;
    leafLift.open(leafFor(id), from, items.get(id));
  }
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-open]');
    if (!el || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    openItem(el.dataset.open, el);
  });

  /* ------------------------------------------------------- the leaf's tag */
  function showTag(leaf) {
    const item = items.get(leaf.dataset.item);
    if (!item || leafLift.busy()) return;
    tag.innerHTML = `<span class="leaftag__kind">${mark(tone(leaf))}${esc(KINDS[item.kind].label)}</span><span class="leaftag__title">${esc(item.title)}</span>`;
    const box = leaf.getBoundingClientRect();
    const w = tag.offsetWidth, h = tag.offsetHeight, vw = document.documentElement.clientWidth;
    const x = Math.min(vw - w - 8, Math.max(8, box.left + box.width / 2 - w / 2));
    const above = box.top - h - 10;
    tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(above > 8 ? above : box.bottom + 10)}px)`;
    tag.classList.add('is-on');
  }
  function hideTag() { tag.classList.remove('is-on'); }
  tree.addEventListener('pointerover', e => { const l = e.target.closest('button.leaf, .trunk'); if (l && e.pointerType !== 'touch') showTag(l); });
  tree.addEventListener('pointerout', e => { if (e.target.closest('button.leaf, .trunk')) hideTag(); });
  tree.addEventListener('focusin', e => { const l = e.target.closest('button.leaf, .trunk'); if (l && l.matches(':focus-visible')) showTag(l); });
  tree.addEventListener('focusout', hideTag);
  const tagged = el => {                           // the same tag for things that are not in the crown
    el.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') showTag(el); });
    el.addEventListener('pointerleave', hideTag);
    el.addEventListener('focus', () => { if (el.matches(':focus-visible')) showTag(el); });
    el.addEventListener('blur', hideTag);
  };
  window.addEventListener('scroll', hideTag, { passive: true });

  /* the trunk opens "our story" with that item's leaf */
  const trunk = $('.trunk');
  trunk.dataset.item = 'our-story';
  trunk.addEventListener('click', e => { e.stopPropagation(); openItem('our-story', trunk); });
  tagged(trunk);

  /* ------------------------------------------------------- the canopy key */
  const key = $('#key-chips');
  const count = k => leaves.filter(l => l.dataset.kind === k).length;
  const chips = [['all', 'All leaves', 't3', leaves.filter(l => l.dataset.item).length],
    ['act', 'Get involved', 't6'], ['work', 'Our work', 't5'], ['gather', 'Gatherings', 't5'],
    ['news', 'News', 't5'], ['about', 'About', 't5'], ['group', 'Member groups', 't2']];
  key.innerHTML = chips.map(([k, label, t, n]) =>
    `<button class="chip" type="button" data-filter="${k}" aria-pressed="${k === 'all'}">${mark(t)}${label} <small>${n ?? count(k)}</small></button>`).join('');
  let chosen = 'all';
  function light(kind) {
    tree.classList.toggle('is-filtered', kind !== 'all');
    leaves.forEach(l => l.classList.toggle('is-lit', l.dataset.kind === kind));
  }
  key.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chosen = chip.dataset.filter === chosen ? 'all' : chip.dataset.filter;
    $$('.chip', key).forEach(c => c.setAttribute('aria-pressed', c.dataset.filter === chosen));
    light(chosen);
  });
  /* pointing at a section in the header shows where it lives in the crown */
  $$('.nav [data-kind]').forEach(a => {
    a.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') light(a.dataset.kind); });
    a.addEventListener('pointerleave', () => light(chosen));
  });

  /* ---------------------------------------------------------- the sections */
  const go = it => `<span class="card__go"><span class="leafmark t2"></span>${esc(it.go || 'Open the leaf')}</span>`;
  const href = it => esc((it.links && it.links[0] && it.links[0].url) || '#');

  /* the campaigns as a grid; mini-grants is a program rather than a campaign, so it gets the full-width strip under them */
  $('#work-cards').innerHTML = work.map(it => it.id === 'mini-grants'
    ? `<li class="wide"><a class="card card--wide" href="${href(it)}" data-open="${it.id}"><div><span class="card__kicker">For members and member groups</span><h3>${esc(it.title)}</h3><p>${esc(it.sum)}</p></div>${go(it)}</a></li>`
    : `<li><a class="card" href="${href(it)}" data-open="${it.id}"><h3>${esc(it.title)}</h3><p>${esc(it.sum)}</p>${go(it)}</a></li>`).join('');

  $('#gather-cards').innerHTML = gather.map((it, i) =>
    `<a class="card gathering" href="${href(it)}" data-open="${it.id}">` +
    `<span class="season" style="--bg:${i ? '#e9a86a' : 'var(--leaf-bright)'}">${i ? 'Fall' : 'Spring'}</span>` +
    `<h3>${esc(it.title)}</h3><p class="when">${esc(it.meta)}</p><p>${esc(it.sum)}</p>${go(it)}</a>`).join('');

  const [issue, ...rest] = news;
  const posts = rest.filter(n => !n.backIssue), back = rest.filter(n => n.backIssue);
  $('#news-issue').innerHTML =
    `<figure class="issue__cover">${photo(issue.img, '17rem')}</figure>` +
    `<span class="card__kicker">Heartbeat · ${esc(issue.date)}</span><h3>${esc(issue.title)}</h3><p>${esc(issue.sum)}</p>` +
    `<div class="dialog__links" style="margin-top:.6rem">${issue.links.map(link).join('')}</div>` +
    `<ul class="issue__back" aria-label="Back issues">${back.map(b => `<li><a href="${href(b)}" data-open="${b.id}">${esc(b.date)}</a></li>`).join('')}</ul>`;
  $('#news-posts').innerHTML = posts.map(it =>
    `<li><a class="card post" href="${href(it)}" data-open="${it.id}"><span class="date">${esc(it.date)}</span><div><h3>${esc(it.title)}</h3><p>${esc(it.sum)}</p></div></a></li>`).join('');

  const list = $('#groups');
  list.innerHTML = groups.map(g =>
    `<li><button type="button" data-open="${g.id}">${esc(g.title)}</button></li>`).join('');
  const groupRows = $$('li', list), groupNames = groups.map(g => g.title.toLowerCase());
  const find = $('#group-find'), tally = $('#group-tally');
  const netList = $('#net-list'), memberStratum = find.closest('.stratum');
  const say = n => { tally.textContent = n === groups.length ? groups.length + ' member groups' : n + ' of ' + groups.length + ' member groups'; };
  say(groups.length);
  /* the network: a spore lights the thread that joins it to Heartwood, and names itself */
  const net = $('#net'), spores = $$('.spore', net);
  const thread = (spore, on) => spore.dataset.path.split(' ').forEach(k => { const t = document.getElementById('hy-' + k); if (t) t.classList.toggle('is-lit', on); });
  spores.forEach(sp => {
    tagged(sp);
    ['pointerenter', 'focus'].forEach(ev => sp.addEventListener(ev, () => thread(sp, true)));
    ['pointerleave', 'blur'].forEach(ev => sp.addEventListener(ev, () => thread(sp, false)));
  });
  net.scrollLeft = (net.scrollWidth - net.clientWidth) / 2;      // on a narrow screen the picture scrolls sideways; start on Heartwood
  const sporeOf = new Map(spores.map(sp => [sp.dataset.item, sp]));
  find.addEventListener('input', () => {
    const q = find.value.trim().toLowerCase();
    let n = 0;
    net.classList.toggle('is-searching', !!q);
    groupRows.forEach((li, i) => {
      const hit = groupNames[i].includes(q), sp = sporeOf.get(groups[i].id);
      li.hidden = !hit; n += hit;
      if (sp) sp.classList.toggle('is-hit', !!q && hit);
    });
    say(n);
    if (q) netList.open = true;                     // the names that match, written out
    scheduleLayout(memberStratum);
  });
  netList.addEventListener('toggle', () => scheduleLayout(memberStratum));
  if (matchMedia('(max-width: 720px)').matches) netList.open = true;   // on a phone the list is the easier way in
  $$('[data-count="groups"]').forEach(el => { el.textContent = groups.length; });

  const person = ([name, where, role]) => `<li>${esc(name)}${role ? ', ' + esc(role) : ''}<span>${esc(where)}</span></li>`;
  $('#council-a').innerHTML = SITE.council.coordinating.map(person).join('');
  $('#council-b').innerHTML = SITE.council.extended.map(person).join('');

  $('#support-cards').innerHTML = act.map((it, i) =>
    `<li class="${i ? '' : 'span2'}"><a class="card ${i ? '' : 'card--gold'}" href="${href(it)}" data-open="${it.id}"><h3>${esc(it.title)}</h3><p>${esc(it.sum)}</p>` +
    (it.tiers ? `<ul class="tiers">${it.tiers.slice(0, 3).map(([n, p]) => `<li><span>${esc(n)}</span><b>${esc(p)}</b></li>`).join('')}</ul>` : '') +
    (!i && it.list ? `<ul class="tiers">${it.list.map(t => `<li><span>${esc(t)}</span></li>`).join('')}</ul>` : '') +
    `${go(it)}</a></li>`).join('');

  /* ------------------------------------------------- stones under the type */
  /* The stones and critters are scattered in % of their stratum, so once a stratum holds text some of
     them land behind a line of it. Lift those out; the rest stay in the margins and between the cards. */
  const typeStrata = $$('.deep .stratum').map(st => ({
    stratum: st,
    type: $$('[data-type], .layer__head > *, .horizon, .more, .foot', st),
    stones: $$('.stones > i', st),
  }));
  const typeStratumOf = new Map(typeStrata.map(entry => [entry.stratum, entry]));
  function clearType(strata) {
    const changes = [];
    strata.forEach(({ type, stones }) => {
      const boxes = type.map(el => el.getBoundingClientRect());
      stones.forEach(bit => {
        const b = bit.getBoundingClientRect(), pad = 6;
        changes.push([bit, boxes.some(t =>
          b.right > t.left - pad && b.left < t.right + pad && b.bottom > t.top - pad && b.top < t.bottom + pad)]);
      });
    });
    changes.forEach(([bit, cleared]) => {
      if (bit.classList.contains('is-cleared') !== cleared) bit.classList.toggle('is-cleared', cleared);
    });
  }

  /* ----------------------------------------------------- the leaf initial */
  /* The first letter of each big heading sits on a paper leaf (see .cap). The heading keeps its full
     text as its accessible name. */
  $$('.hero h1, .layer h2:not(.visually-hidden)').forEach(h => {
    const t = h.textContent;
    h.setAttribute('aria-label', t);
    h.innerHTML = `<span class="cap" aria-hidden="true">${esc(t[0])}</span><span aria-hidden="true">${esc(t.slice(1))}</span>`;
  });

  /* the tree mark of each section label stands over the middle of the capital on the leaf below it */
  const headingMarks = $$('.layer').map(layer => ({ mark: $('.horizon .mark', layer), cap: $('.cap', layer) }))
    .filter(({ mark, cap }) => mark && cap);
  headingMarks.forEach(({ mark }) => mark.style.setProperty('--shift', '0px'));   // override the artwork's inherited crop offset once
  function seatMarks() {
    const shifts = headingMarks.map(({ mark, cap }) => {
      const previous = parseFloat(mark.style.getPropertyValue('--shift')) || 0;
      const c = cap.getBoundingClientRect(), m = mark.getBoundingClientRect();
      return [mark, Math.max(0, previous + c.left + c.width / 2 - (m.left + m.width / 2)).toFixed(1) + 'px'];
    });
    shifts.forEach(([mark, shift]) => {
      if (mark.style.getPropertyValue('--shift') !== shift) mark.style.setProperty('--shift', shift);
    });
  }

  /* Coalesce geometry changes; search only changes its own stratum. Later strata move as a unit. */
  const dirtyStrata = new Set();
  let layoutFrame = 0, marksDirty = false, tidy;
  function scheduleLayout(stratum, marks = false) {
    const affected = stratum ? [typeStratumOf.get(stratum)] : typeStrata;
    affected.forEach(entry => { if (entry) dirtyStrata.add(entry); });
    marksDirty = marksDirty || marks;
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      if (marksDirty) seatMarks();
      marksDirty = false;
      clearType([...dirtyStrata]);
      dirtyStrata.clear();
    });
  }
  scheduleLayout(null, true);
  window.addEventListener('resize', () => {
    clearTimeout(tidy);
    tidy = setTimeout(() => scheduleLayout(null, true), 150);
  });
  if (document.fonts) document.fonts.ready.then(() => scheduleLayout(null, true));

  /* Keep visible foreground creatures moving; pause the same loops offscreen, hidden or unfocused. */
  const motionRegions = $$('.stage, .deep .stratum');
  const updateVisibility = () => document.documentElement.classList.toggle('is-motion-hidden', document.hidden || !document.hasFocus());
  document.addEventListener('visibilitychange', updateVisibility);
  window.addEventListener('focus', updateVisibility);
  window.addEventListener('blur', updateVisibility);
  updateVisibility();
  if ('IntersectionObserver' in window) {
    const motionObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      entry.target.classList.toggle('is-motion-paused', !entry.isIntersecting);
    }), { rootMargin: '200px' });
    motionRegions.forEach(region => motionObserver.observe(region));
  }

  /* Let initial fragments arrive before enabling smooth in-page navigation. */
  const smoothScroll = () => document.documentElement.classList.add('is-smooth-scroll');
  const smoothAfterLoad = () => requestAnimationFrame(() => requestAnimationFrame(smoothScroll));
  if (document.readyState === 'complete') smoothAfterLoad(); else window.addEventListener('load', smoothAfterLoad, { once: true });
  ['pointerdown', 'keydown'].forEach(type => window.addEventListener(type, smoothScroll, { capture: true, passive: true, once: true }));

  /* --------------------------------------------------------------- header */
  const top = $('.top'), menu = $('.top__menu');
  const stuck = () => {
    top.classList.toggle('is-stuck', window.scrollY > 8);
    if (window.scrollY < 200) $$('.nav [aria-current]').forEach(a => a.removeAttribute('aria-current'));   // back at the tree
  };
  window.addEventListener('scroll', stuck, { passive: true }); stuck();
  menu.addEventListener('click', () => menu.setAttribute('aria-expanded', top.classList.toggle('is-open')));
  $('#nav').addEventListener('click', e => { if (e.target.closest('a')) { top.classList.remove('is-open'); menu.setAttribute('aria-expanded', 'false'); } });
  if ('IntersectionObserver' in window) {        // mark the section being read
    const links = new Map($$('.nav a[href^="#"]').map(a => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver(es => es.forEach(en => {
      const a = links.get(en.target.id);
      if (a && en.isIntersecting) { links.forEach(l => l.removeAttribute('aria-current')); a.setAttribute('aria-current', 'true'); }
    }), { rootMargin: '-45% 0px -50% 0px' });
    links.forEach((a, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  livePhotos.watch(document);

  /* a link straight to a leaf: page.html#leaf-forest-watch */
  const wanted = location.hash.match(/^#leaf-(.+)$/);
  if (wanted && items.has(wanted[1])) setTimeout(() => openItem(wanted[1]), 1300);
})();
