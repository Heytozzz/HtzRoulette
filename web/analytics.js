// Usage statistics with GoatCounter (privacy friendly: no cookies, no personal data).
// 1) Create a free account at https://www.goatcounter.com and pick a site code.
// 2) Put that code below (for example 'htzroulette'). While it is empty, nothing is loaded.
(() => {
  const CODE = 'heytoz';
  if (!CODE) return;
  // OBS overlays (index.html?overlay=...) are not visits
  if (new URLSearchParams(window.location.search).has('overlay')) return;

  const script = document.createElement('script');
  script.async = true;
  script.setAttribute('data-goatcounter', `https://${CODE}.goatcounter.com/count`);
  script.src = 'https://gc.zgo.at/count.js';
  document.head.appendChild(script);
})();
