// @ts-nocheck
const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'images', 'generated', 'abs-3in');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');
const ENV_PATH = path.join(ROOT, '.env');

function getDatabaseUrl() {
  const envText = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^DATABASE_URL=(.*)$/);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  throw new Error('DATABASE_URL not found in .env');
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/°/g, 'deg')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function deduceKind(description) {
  const d = description.toLowerCase();
  if (d.includes('p-trap')) return 'ptrap';
  if (d.includes('double sanitary tee')) return 'double-tee';
  if (d.includes('sanitary tee') || d.includes('cleanout tee') || d.includes('tee')) return 'tee';
  if (d.includes('double wye')) return 'double-wye';
  if (d.includes('wye') || d.includes('ty')) return 'wye';
  if (d.includes('street elbow')) return 'street-elbow';
  if (d.includes('vent elbow')) return 'vent-elbow';
  if (d.includes('elbow')) return 'elbow';
  if (d.includes('drain grate')) return 'drain-grate';
  if (d.includes('test plates')) return 'test-plate';
  if (d.includes('test cap')) return 'test-cap';
  if (d.includes('plug')) return 'plug';
  if (d.includes('cap')) return 'cap';
  if (d.includes('expansion joint')) return 'expansion-joint';
  if (d.includes('reducing coupling')) return 'reducing-coupling';
  if (d.includes('coupling')) return 'coupling';
  if (d.includes('adapter') || d.includes('fip') || d.includes('mip')) return 'adapter';
  if (d.includes('bushing') || d.includes('increaser') || d.includes('reduc')) return 'bushing';
  if (d.includes('pipe')) return 'pipe';
  if (d.includes('cleanout')) return 'cleanout';
  if (d.includes('end cleanout')) return 'cleanout';
  return 'generic';
}

function getAngle(description) {
  const match = description.match(/(22\.5|45|60|90)/);
  return match ? Number(match[1]) : 90;
}

function tube({ x1, y1, x2, y2, width = 128, color = '#121212', inner = '#2b2b2b', shadow = true }) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const dx = Math.cos(angle + Math.PI / 2) * width * 0.22;
  const dy = Math.sin(angle + Math.PI / 2) * width * 0.22;
  return `
    ${shadow ? `<line x1="${x1 + 10}" y1="${y1 + 14}" x2="${x2 + 10}" y2="${y2 + 14}" stroke="#000" stroke-opacity="0.12" stroke-width="${width}" stroke-linecap="round"/>` : ''}
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>
    <line x1="${x1 - dx}" y1="${y1 - dy}" x2="${x2 - dx}" y2="${y2 - dy}" stroke="#444" stroke-opacity="0.55" stroke-width="${Math.max(12, width * 0.08)}" stroke-linecap="round"/>
    <line x1="${x1 + dx}" y1="${y1 + dy}" x2="${x2 + dx}" y2="${y2 + dy}" stroke="#000" stroke-opacity="0.2" stroke-width="${Math.max(12, width * 0.08)}" stroke-linecap="round"/>
    <ellipse cx="${x1}" cy="${y1}" rx="${width / 2}" ry="${width / 2.8}" fill="${inner}" transform="rotate(${(angle * 180) / Math.PI} ${x1} ${y1})" />
    <ellipse cx="${x1}" cy="${y1}" rx="${width / 2.5}" ry="${width / 3.5}" fill="#111" transform="rotate(${(angle * 180) / Math.PI} ${x1} ${y1})" />
    <ellipse cx="${x2}" cy="${y2}" rx="${width / 2}" ry="${width / 2.8}" fill="${inner}" transform="rotate(${(angle * 180) / Math.PI} ${x2} ${y2})" />
    <ellipse cx="${x2}" cy="${y2}" rx="${width / 2.5}" ry="${width / 3.5}" fill="#111" transform="rotate(${(angle * 180) / Math.PI} ${x2} ${y2})" />
  `;
}

function rectTube({ x, y, w, h, radius = 56, color = '#121212' }) {
  return `
    <rect x="${x + 10}" y="${y + 14}" width="${w}" height="${h}" rx="${radius}" fill="#000" fill-opacity="0.12"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${color}"/>
    <rect x="${x + 18}" y="${y + 18}" width="${w - 36}" height="${Math.max(12, h * 0.12)}" rx="${radius / 2}" fill="#444" fill-opacity="0.5"/>
  `;
}

function ring({ cx, cy, rOuter, rInner, color = '#141414' }) {
  return `
    <circle cx="${cx}" cy="${cy}" r="${rOuter + 8}" fill="#000" fill-opacity="0.09"/>
    <circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="${color}"/>
    <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="#111"/>
    <circle cx="${cx - rOuter * 0.15}" cy="${cy - rOuter * 0.15}" r="${rOuter * 0.62}" fill="none" stroke="#4c4c4c" stroke-width="10" stroke-opacity="0.55"/>
  `;
}

function background() {
  return `
    <rect width="1024" height="1024" rx="72" fill="#f8f8f6"/>
    <ellipse cx="512" cy="820" rx="270" ry="74" fill="#000" fill-opacity="0.08"/>
    <rect x="90" y="90" width="844" height="844" rx="64" fill="url(#bgGlow)" fill-opacity="0.8"/>
  `;
}

function defs() {
  return `
    <defs>
      <radialGradient id="bgGlow" cx="50%" cy="35%" r="70%">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#efefeb"/>
      </radialGradient>
    </defs>
  `;
}

function drawElbow(description, options = {}) {
  const angle = getAngle(description);
  const endY = angle <= 45 ? 350 : angle <= 60 ? 290 : 230;
  const body = `
    ${tube({ x1: 350, y1: 700, x2: 350, y2: 470, width: 134 })}
    ${tube({ x1: 405, y1: 415, x2: 690, y2: endY, width: 134 })}
    <circle cx="390" cy="430" r="92" fill="#151515"/>
    <circle cx="390" cy="430" r="46" fill="#111"/>
  `;
  if (options.street) {
    return body + `<rect x="645" y="${endY - 54}" width="150" height="108" rx="40" fill="#1d1d1d" transform="rotate(-22 ${645 + 75} ${endY})"/>`;
  }
  if (options.vent) {
    return body + `<line x1="458" y1="370" x2="720" y2="185" stroke="#3f3f3f" stroke-width="22" stroke-linecap="round" opacity="0.9"/>`;
  }
  if (options.long) {
    return body + `<line x1="300" y1="750" x2="300" y2="860" stroke="#202020" stroke-width="96" stroke-linecap="round"/>`;
  }
  if (options.extraLong) {
    return body + `<line x1="300" y1="740" x2="300" y2="900" stroke="#202020" stroke-width="96" stroke-linecap="round"/>`;
  }
  if (options.threeWay) {
    return body + `${tube({ x1: 390, y1: 430, x2: 170, y2: 250, width: 110, shadow: false })}`;
  }
  return body;
}

function drawWye(doubleWye = false) {
  const base = `${tube({ x1: 230, y1: 720, x2: 790, y2: 720, width: 126 })}${tube({ x1: 520, y1: 660, x2: 300, y2: 380, width: 116, shadow: false })}`;
  return doubleWye ? base + tube({ x1: 520, y1: 660, x2: 740, y2: 380, width: 116, shadow: false }) : base;
}

function drawTee(doubleTee = false, cleanout = false) {
  const base = `${tube({ x1: 250, y1: 540, x2: 770, y2: 540, width: 126 })}${tube({ x1: 510, y1: 760, x2: 510, y2: 320, width: 118, shadow: false })}`;
  if (doubleTee) return base + tube({ x1: 700, y1: 540, x2: 700, y2: 320, width: 102, shadow: false });
  if (cleanout) return base + ring({ cx: 510, cy: 250, rOuter: 94, rInner: 46 });
  return base;
}

function drawCoupling(reducing = false, expansion = false) {
  if (expansion) {
    return `${tube({ x1: 240, y1: 540, x2: 790, y2: 540, width: 108 })}${rectTube({ x: 360, y: 420, w: 300, h: 240, radius: 72, color: '#181818' })}${rectTube({ x: 452, y: 390, w: 120, h: 300, radius: 50, color: '#2a2a2a' })}`;
  }
  return `${tube({ x1: 220, y1: 540, x2: 820, y2: 540, width: reducing ? 102 : 118 })}${rectTube({ x: reducing ? 350 : 330, y: 430, w: reducing ? 330 : 370, h: reducing ? 220 : 230, radius: 72, color: '#171717' })}${reducing ? `<rect x="610" y="455" width="130" height="170" rx="52" fill="#232323"/>` : ''}`;
}

function drawAdapter() {
  return `${tube({ x1: 260, y1: 560, x2: 740, y2: 560, width: 112 })}${rectTube({ x: 490, y: 430, w: 250, h: 260, radius: 62, color: '#1d1d1d' })}${ring({ cx: 760, cy: 560, rOuter: 92, rInner: 38, color: '#252525' })}`;
}

function drawBushing() {
  return `${ring({ cx: 512, cy: 560, rOuter: 200, rInner: 116, color: '#161616' })}${ring({ cx: 512, cy: 560, rOuter: 104, rInner: 44, color: '#202020' })}`;
}

function drawPipe(variant = 'solid') {
  return `${tube({ x1: 180, y1: 540, x2: 844, y2: 540, width: 142, color: variant === 'cell' ? '#111' : '#151515' })}${variant === 'cell' ? `<line x1="230" y1="540" x2="790" y2="540" stroke="#3b3b3b" stroke-width="10" stroke-dasharray="24 18" stroke-linecap="round" opacity="0.75"/>` : ''}`;
}

function drawCap(testCap = false) {
  const color = testCap ? '#d86b27' : '#141414';
  return `${tube({ x1: 250, y1: 560, x2: 640, y2: 560, width: 126, color })}<rect x="620" y="435" width="170" height="250" rx="80" fill="${testCap ? '#ea7b2f' : '#171717'}"/><rect x="662" y="470" width="88" height="180" rx="36" fill="${testCap ? '#f29a49' : '#232323'}"/>`;
}

function drawPlug() {
  return `${ring({ cx: 512, cy: 540, rOuter: 160, rInner: 50 })}<rect x="446" y="335" width="132" height="74" rx="28" fill="#262626"/><rect x="482" y="274" width="60" height="82" rx="20" fill="#2f2f2f"/>`;
}

function drawPTrap() {
  return `${tube({ x1: 280, y1: 340, x2: 280, y2: 620, width: 112 })}<path d="M280 620 C280 760 460 810 565 720 C632 662 630 570 630 470" fill="none" stroke="#141414" stroke-width="112" stroke-linecap="round"/><path d="M632 470 L632 260" fill="none" stroke="#141414" stroke-width="112" stroke-linecap="round"/>`;
}

function drawDrainGrate() {
  let slots = '';
  for (let i = 0; i < 6; i++) {
    slots += `<rect x="${390 + i * 42}" y="435" width="22" height="210" rx="10" fill="#1a1a1a"/>`;
  }
  return `<circle cx="512" cy="540" r="220" fill="#242424"/><circle cx="512" cy="540" r="185" fill="#363636"/>${slots}<circle cx="512" cy="540" r="72" fill="#242424"/>`;
}

function drawTestPlate() {
  return `<rect x="260" y="250" width="504" height="504" rx="42" fill="#d66b2f"/><rect x="300" y="290" width="424" height="424" rx="28" fill="#ef8443"/><circle cx="512" cy="540" r="86" fill="#cf5b24"/>`;
}

function drawCleanout() {
  return `${tube({ x1: 240, y1: 560, x2: 794, y2: 560, width: 118 })}${ring({ cx: 650, cy: 560, rOuter: 92, rInner: 42, color: '#222' })}<rect x="620" y="385" width="60" height="126" rx="18" fill="#2c2c2c"/>`;
}

function drawGeneric() {
  return `${tube({ x1: 250, y1: 560, x2: 774, y2: 560, width: 122 })}${ring({ cx: 512, cy: 560, rOuter: 96, rInner: 46, color: '#1f1f1f' })}`;
}

function renderPart(description) {
  const kind = deduceKind(description);
  const lower = description.toLowerCase();

  let art;
  switch (kind) {
    case 'ptrap': art = drawPTrap(); break;
    case 'double-tee': art = drawTee(true, false); break;
    case 'tee': art = drawTee(false, lower.includes('cleanout')); break;
    case 'double-wye': art = drawWye(true); break;
    case 'wye': art = drawWye(false); break;
    case 'street-elbow': art = drawElbow(description, { street: true }); break;
    case 'vent-elbow': art = drawElbow(description, { vent: true }); break;
    case 'elbow': art = drawElbow(description, { long: lower.includes('long turn') && !lower.includes('extra'), extraLong: lower.includes('extra long'), threeWay: lower.includes('3-way') }); break;
    case 'drain-grate': art = drawDrainGrate(); break;
    case 'test-plate': art = drawTestPlate(); break;
    case 'test-cap': art = drawCap(true); break;
    case 'plug': art = drawPlug(); break;
    case 'cap': art = drawCap(false); break;
    case 'expansion-joint': art = drawCoupling(false, true); break;
    case 'reducing-coupling': art = drawCoupling(true, false); break;
    case 'coupling': art = drawCoupling(false, false); break;
    case 'adapter': art = drawAdapter(); break;
    case 'bushing': art = drawBushing(); break;
    case 'pipe': art = drawPipe(lower.includes('cell') ? 'cell' : 'solid'); break;
    case 'cleanout': art = drawCleanout(); break;
    default: art = drawGeneric(); break;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
    ${defs()}
    ${background()}
    ${art}
    <rect x="92" y="92" width="840" height="840" rx="64" stroke="#e6e6e0" stroke-width="4"/>
  </svg>`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sql = postgres(getDatabaseUrl(), { ssl: 'require' });
  const rows = await sql`
    select pd.id, pd.description, pd."displayName"
    from kublai_part_definition pd
    left join kublai_material m on m.id = pd."materialId"
    left join kublai_size s on s.id = pd."sizeId"
    left join kublai_unit u on u.id = s."unitId"
    where lower(coalesce(m.name,'')) = 'abs'
      and s.nominal = '3'
      and lower(coalesce(u.code,'')) = 'in'
      and coalesce(pd."isActive", true) = true
    order by coalesce(pd.description, pd."displayName") asc;
  `;

  const manifest = [];
  const usedSlugs = new Set();
  for (const row of rows) {
    const description = row.description || row.displayName;
    const baseSlug = slugify(description);
    let slug = baseSlug;
    if (usedSlugs.has(slug)) {
      slug = `${baseSlug}-${row.id.slice(0, 8)}`;
    }
    usedSlugs.add(slug);
    const fileName = `${slug}.svg`;
    const filePath = path.join(OUT_DIR, fileName);
    const publicPath = `/images/generated/abs-3in/${fileName}`;
    fs.writeFileSync(filePath, renderPart(description), 'utf8');
    await sql`
      update kublai_part_definition
      set "imageUrl" = ${publicPath}
      where id = ${row.id}::uuid
    `;
    manifest.push({ id: row.id, description, imageUrl: publicPath });
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await sql.end({ timeout: 5 });
  console.log(JSON.stringify({ generated: manifest.length, outDir: OUT_DIR, manifest: MANIFEST_PATH }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
