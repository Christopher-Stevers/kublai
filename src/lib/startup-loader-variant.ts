// Picks which startup loading scene to play, before first paint, so the scene
// never swaps once visible. Random per app open, never the same twice in a row.
// Without it (scripts off, storage blocked) the orbit scene shows.
export const LOADER_VARIANTS = ["orbit", "blueprint", "bricks", "level"] as const;

export const LOADER_VARIANT_SCRIPT = `(function(){try{var v=${JSON.stringify(LOADER_VARIANTS)},k="foremanhq:loader-variant",l=localStorage.getItem(k),c=v.filter(function(x){return x!==l}),p=c[Math.floor(Math.random()*c.length)];localStorage.setItem(k,p);document.documentElement.setAttribute("data-loader-variant",p)}catch(e){}})();`;
