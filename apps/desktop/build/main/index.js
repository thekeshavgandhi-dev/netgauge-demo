"use strict";

// src/main/index.ts
var import_electron4 = require("electron");

// ../../packages/core/src/format.ts
var BIT_UNITS = [
  { scale: 1e9, unit: "Gbps" },
  { scale: 1e6, unit: "Mbps" },
  { scale: 1e3, unit: "kbps" }
];
var BYTE_UNITS = [
  { scale: 1e9, unit: "GB/s" },
  { scale: 1e6, unit: "MB/s" },
  { scale: 1e3, unit: "kB/s" }
];
function formatSpeed(bitsPerSecond, mode = "bits", options = {}) {
  const { pinned = "auto", digits, separator = " " } = options;
  const safe = Number.isFinite(bitsPerSecond) ? Math.max(0, bitsPerSecond) : 0;
  if (pinned !== "auto") {
    const table = {
      kbps: { scale: 1e3, unit: "kbps", fromBits: 1 },
      mbps: { scale: 1e6, unit: "Mbps", fromBits: 1 },
      gbps: { scale: 1e9, unit: "Gbps", fromBits: 1 },
      kBps: { scale: 1e3, unit: "kB/s", fromBits: 8 },
      MBps: { scale: 1e6, unit: "MB/s", fromBits: 8 },
      GBps: { scale: 1e9, unit: "GB/s", fromBits: 8 }
    };
    const t = table[pinned];
    const value = safe / t.fromBits / t.scale;
    return { value, unit: t.unit, text: `${trim(value, digits ?? 2)}${separator}${t.unit}`, scale: t.scale };
  }
  const units = mode === "bits" ? BIT_UNITS : BYTE_UNITS;
  const value0 = mode === "bits" ? safe : safe / 8;
  for (const { scale, unit: unit2 } of units) {
    if (value0 >= scale) {
      const value = value0 / scale;
      return { value, unit: unit2, text: `${trim(value, digits ?? (value < 10 ? 2 : 1))}${separator}${unit2}`, scale };
    }
  }
  const unit = mode === "bits" ? "bps" : "B/s";
  return { value: value0, unit, text: `${trim(value0, 0)}${separator}${unit}`, scale: 1 };
}
function trim(value, digits) {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

// ../../packages/core/src/stats.ts
function clamp(value, min2, max) {
  return Math.min(max, Math.max(min2, value));
}
function ema(previous, next, alpha) {
  const a = clamp(alpha, 0, 1);
  return previous * (1 - a) + next * a;
}

// ../../packages/core/src/iface.ts
function parseProcNetDev(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    if (!name) continue;
    const fields = line.slice(idx + 1).trim().split(/\s+/).map(Number);
    if (fields.length < 9) continue;
    const rxBytes = fields[0] ?? 0;
    const txBytes = fields[8] ?? 0;
    if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue;
    out.push({ name, rxBytes, txBytes });
  }
  return out;
}
function toNumber(raw) {
  if (!raw) return 0;
  const n = Number(raw.replace(/"/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function parseNetstatIb(text) {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = (lines[0] ?? "").trim().split(/\s+/);
  const nameIdx = header.indexOf("Name");
  const inIdx = header.indexOf("Ibytes");
  const outIdx = header.indexOf("Obytes");
  if (nameIdx < 0 || inIdx < 0 || outIdx < 0) return [];
  const best = /* @__PURE__ */ new Map();
  for (let i = 1; i < lines.length; i += 1) {
    const cells = (lines[i] ?? "").trim().split(/\s+/);
    const name = cells[nameIdx];
    if (!name) continue;
    const rxBytes = toNumber(cells[inIdx]);
    const txBytes = toNumber(cells[outIdx]);
    const existing = best.get(name);
    if (!existing || rxBytes + txBytes > existing.rxBytes + existing.txBytes) {
      best.set(name, { name, rxBytes, txBytes });
    }
  }
  return [...best.values()];
}
var VIRTUAL_PATTERNS = [
  /^lo$/,
  /^loopback/i,
  /^veth/,
  /^docker/,
  /^br-/,
  /^virbr/,
  /^vboxnet/,
  /^vmnet/,
  /^tun\d/,
  /^tap\d/,
  /Local Area Connection\* \d+/,
  /^Bluetooth/i,
  /^WAN Miniport/i
];
function isPhysicalInterface(name) {
  return !VIRTUAL_PATTERNS.some((re) => re.test(name.trim()));
}
function selectInterfaces(list, options = {}) {
  if (options.only) {
    const wanted = options.only.trim().toLowerCase();
    return list.filter((i) => i.name.toLowerCase() === wanted);
  }
  return list.filter((i) => options.includeVirtual || isPhysicalInterface(i.name));
}
function diffCounters(prev, next, seconds, options = {}) {
  if (seconds <= 0) {
    return { downBps: 0, upBps: 0, totalBps: 0, rxBytes: 0, txBytes: 0, interfaces: [] };
  }
  const before = new Map(selectInterfaces(prev, options).map((i) => [i.name, i]));
  const after = selectInterfaces(next, options);
  let rxBytes = 0;
  let txBytes = 0;
  const interfaces = [];
  for (const iface of after) {
    const was = before.get(iface.name);
    if (!was) continue;
    const dRx = iface.rxBytes - was.rxBytes;
    const dTx = iface.txBytes - was.txBytes;
    if (dRx < 0 || dTx < 0) continue;
    rxBytes += dRx;
    txBytes += dTx;
    if (dRx + dTx > 0) interfaces.push(iface.name);
  }
  const downBps = rxBytes / seconds * 8;
  const upBps = txBytes / seconds * 8;
  return { downBps, upBps, totalBps: downBps + upBps, rxBytes, txBytes, interfaces };
}

// ../../packages/core/src/tray.ts
var TRANSPARENT = [0, 0, 0, 0];
function renderTrayIcon(options = {}) {
  const size = Math.max(8, Math.round(options.size ?? 16));
  const scale = Math.max(1, Math.round(options.scale ?? 2));
  const w = size * scale;
  const data = new Uint8Array(w * w * 4);
  const ctx = { width: w, height: w, data };
  const accent = options.accent ?? [56, 189, 248];
  const dim = options.dim ?? false;
  const level = clamp01(options.level ?? 0);
  const mode = options.mode ?? "bars";
  if (mode === "paused") {
    drawBars(ctx, [0.15, 0.15, 0.15, 0.15], dim ? [120, 120, 120] : accent, 0.35);
    return downscale(ctx, size, [140, 140, 140]);
  }
  if (mode === "sparkline") {
    drawSparkline(ctx, options.history ?? [], dim ? [150, 150, 150] : accent);
    return downscale(ctx, size);
  }
  const bars = levelToBars(level);
  drawBars(ctx, bars, dim ? [150, 150, 150] : accent, 1);
  return downscale(ctx, size);
}
function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
function setPixel(ctx, x, y, color) {
  if (x < 0 || y < 0 || x >= ctx.width || y >= ctx.height) return;
  const i = (Math.floor(y) * ctx.width + Math.floor(x)) * 4;
  const [r, g, b, a] = color;
  const sa = a / 255;
  const da = ctx.data[i + 3] ?? 0;
  const outA = sa + da / 255 * (1 - sa);
  ctx.data[i] = outA === 0 ? 0 : Math.round((r * sa + (ctx.data[i] ?? 0) * (da / 255) * (1 - sa)) / outA);
  ctx.data[i + 1] = outA === 0 ? 0 : Math.round((g * sa + (ctx.data[i + 1] ?? 0) * (da / 255) * (1 - sa)) / outA);
  ctx.data[i + 2] = outA === 0 ? 0 : Math.round((b * sa + (ctx.data[i + 2] ?? 0) * (da / 255) * (1 - sa)) / outA);
  ctx.data[i + 3] = Math.round(outA * 255);
}
function fillRect(ctx, x, y, w, h, color) {
  for (let py = Math.floor(y); py < Math.floor(y + h); py += 1) {
    for (let px = Math.floor(x); px < Math.floor(x + w); px += 1) {
      setPixel(ctx, px, py, color);
    }
  }
}
function levelToBars(level) {
  const heights = [0.3, 0.53, 0.76, 1];
  return heights.map((h) => level >= h - 0.12 ? 1 : 0.22);
}
function drawBars(ctx, bars, rgb, globalAlpha) {
  const s = ctx.width;
  const pad = Math.max(1, Math.round(s * 0.06));
  const gap = Math.max(1, Math.round(s * 0.09));
  const barW = (s - pad * 2 - gap * (bars.length - 1)) / bars.length;
  const bottom = s - pad;
  bars.forEach((alpha, i) => {
    const h = Math.max(1, Math.round((s - pad * 2) * bars[i]));
    const x = pad + i * (barW + gap);
    const color = [rgb[0], rgb[1], rgb[2], Math.round(255 * alpha * globalAlpha)];
    fillRect(ctx, x, bottom - h, barW, h, color);
  });
  void TRANSPARENT;
}
function drawSparkline(ctx, history, rgb) {
  const s = ctx.width;
  const pad = Math.max(1, Math.round(s * 0.09));
  const points = history.slice(-Math.max(8, Math.floor(s / 1.5)));
  if (points.length < 2) {
    fillRect(ctx, pad, s / 2 - 1, s - pad * 2, 2, [rgb[0], rgb[1], rgb[2], 255]);
    return;
  }
  const stepX = (s - pad * 2) / (points.length - 1);
  const y = (v) => s - pad - clamp01(v) * (s - pad * 2);
  const thickness = Math.max(1, Math.round(s * 0.09));
  for (let i = 1; i < points.length; i += 1) {
    const x0 = pad + (i - 1) * stepX;
    const x1 = pad + i * stepX;
    const y0 = y(points[i - 1] ?? 0);
    const y1 = y(points[i] ?? 0);
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let k = 0; k <= steps; k += 1) {
      const t = steps === 0 ? 0 : k / steps;
      fillRect(ctx, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, thickness, thickness, [rgb[0], rgb[1], rgb[2], 255]);
    }
  }
}
function downscale(ctx, size, tint) {
  const factor = ctx.width / size;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          const i = ((y * factor + sy) * ctx.width + (x * factor + sx)) * 4;
          const sa = (ctx.data[i + 3] ?? 0) / 255;
          r += (ctx.data[i] ?? 0) * sa;
          g += (ctx.data[i + 1] ?? 0) * sa;
          b += (ctx.data[i + 2] ?? 0) * sa;
          a += ctx.data[i + 3] ?? 0;
          n += 1;
        }
      }
      const o = (y * size + x) * 4;
      const alpha = a / n;
      const na = alpha / 255;
      data[o] = tint ? tint[0] : na === 0 ? 0 : Math.round(r / n / na);
      data[o + 1] = tint ? tint[1] : na === 0 ? 0 : Math.round(g / n / na);
      data[o + 2] = tint ? tint[2] : na === 0 ? 0 : Math.round(b / n / na);
      data[o + 3] = Math.round(alpha);
    }
  }
  return { width: size, height: size, data };
}
function trayTooltip(opts) {
  if (opts.paused) return "NetGauge \u2014 monitoring paused";
  const iface = opts.iface ? ` \xB7 ${opts.iface}` : "";
  return `NetGauge \xB7 \u2193 ${opts.down} \xB7 \u2191 ${opts.up}${iface}`;
}

// ../../packages/core/src/speedtest/types.ts
var DEFAULTS = {
  phaseDurationMs: 1e4,
  concurrency: 6,
  warmupFraction: 0.2,
  pingCount: 9,
  /** Chunk sizes each stream walks through, 1 MiB → 32 MiB. */
  chunkRamp: [1, 2, 4, 8, 16, 32].map((mb) => mb * 1024 * 1024),
  /** Progress callbacks are throttled to this cadence. */
  progressIntervalMs: 100
};

// src/main/ipc.ts
var import_electron = require("electron");

// src/shared/bridge.ts
var FONT_CHOICES = [
  { id: "inter", label: "Inter", family: "'Inter Variable'", kind: "ui", note: "Neutral, highly legible" },
  { id: "manrope", label: "Manrope", family: "'Manrope Variable'", kind: "ui", note: "Semi-geometric, warm" },
  { id: "space-grotesk", label: "Space Grotesk", family: "'Space Grotesk Variable'", kind: "display", note: "Techy, great numerals" },
  { id: "sora", label: "Sora", family: "'Sora Variable'", kind: "display", note: "Wide, modern grotesque" },
  { id: "outfit", label: "Outfit", family: "'Outfit Variable'", kind: "display", note: "Clean geometric" },
  { id: "bricolage", label: "Bricolage Grotesque", family: "'Bricolage Grotesque Variable'", kind: "display", note: "Editorial, characterful" },
  { id: "unbounded", label: "Unbounded", family: "'Unbounded Variable'", kind: "display", note: "Loud display face" },
  { id: "chakra-petch", label: "Chakra Petch", family: "'Chakra Petch'", kind: "display", note: "HUD / instrument panel" },
  { id: "rajdhani", label: "Rajdhani", family: "'Rajdhani'", kind: "display", note: "Condensed, dense" },
  { id: "jetbrains-mono", label: "JetBrains Mono", family: "'JetBrains Mono Variable'", kind: "mono", note: "Tabular numerals" },
  { id: "geist-mono", label: "Geist Mono", family: "'Geist Mono Variable'", kind: "mono", note: "Tight, engineered" },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", family: "'IBM Plex Mono'", kind: "mono", note: "Classic instrument look" }
];
var DEFAULT_SETTINGS = {
  version: 1,
  appearance: {
    theme: "dark",
    glass: "acrylic",
    opacity: 0.62,
    blur: 26,
    accent: "#22d3ee",
    cornerRadius: 18,
    uiFont: "'Inter Variable'",
    displayFont: "'Space Grotesk Variable'",
    monoFont: "'JetBrains Mono Variable'",
    fontScale: 1,
    fontWeight: 400,
    letterSpacing: -0.01,
    showGlow: true,
    showNoise: true
  },
  widget: {
    enabled: true,
    alwaysOnTop: true,
    clickThrough: false,
    width: 300,
    scale: 1,
    position: null,
    showSparkline: true,
    showPeak: true,
    showAdapter: true
  },
  monitor: {
    sampleMs: 1e3,
    smoothing: 0.35,
    unit: "bits",
    adapter: "auto",
    includeVirtual: false,
    referenceMbps: 300,
    paused: false
  },
  speedTest: {
    serverUrl: "",
    concurrency: 6,
    phaseDurationMs: 1e4
  },
  behaviour: {
    launchAtLogin: false,
    startHidden: false,
    minimizeToTray: true,
    notifyOnDrop: false,
    warnBelowMbps: 10
  }
};
var GLASS_MODES = ["acrylic", "mica", "transparent", "solid"];
var THEMES = ["dark", "light", "system"];
var UNITS = ["bits", "bytes"];
function num(value, fallback, min2, max) {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min2, n));
}
function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function str(value, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}
function oneOf(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
var HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
function hex(value, fallback) {
  if (typeof value !== "string") return fallback;
  const candidate = value.startsWith("#") ? value : `#${value}`;
  if (!HEX.test(candidate)) return fallback;
  if (candidate.length === 4) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`.toLowerCase();
  }
  return candidate.toLowerCase();
}
function fontFamily(value, fallback) {
  if (typeof value !== "string") return fallback;
  const match = FONT_CHOICES.find((f) => f.family === value || f.id === value || f.label === value);
  return match ? match.family : fallback;
}
function sanitizeSettings(input) {
  const d = DEFAULT_SETTINGS;
  const raw = input ?? {};
  const a = raw.appearance ?? {};
  const w = raw.widget ?? {};
  const m = raw.monitor ?? {};
  const s = raw.speedTest ?? {};
  const b = raw.behaviour ?? {};
  const position = w.position && typeof w.position === "object" && w.position !== null ? { x: num(w.position.x, 0, -32e3, 32e3), y: num(w.position.y, 0, -32e3, 32e3) } : null;
  return {
    version: 1,
    appearance: {
      theme: oneOf(a.theme, THEMES, d.appearance.theme),
      glass: oneOf(a.glass, GLASS_MODES, d.appearance.glass),
      opacity: num(a.opacity, d.appearance.opacity, 0.15, 1),
      blur: num(a.blur, d.appearance.blur, 0, 60),
      accent: hex(a.accent, d.appearance.accent),
      cornerRadius: num(a.cornerRadius, d.appearance.cornerRadius, 0, 32),
      uiFont: fontFamily(a.uiFont, d.appearance.uiFont),
      displayFont: fontFamily(a.displayFont, d.appearance.displayFont),
      monoFont: fontFamily(a.monoFont, d.appearance.monoFont),
      fontScale: num(a.fontScale, d.appearance.fontScale, 0.8, 1.4),
      fontWeight: num(a.fontWeight, d.appearance.fontWeight, 300, 700),
      letterSpacing: num(a.letterSpacing, d.appearance.letterSpacing, -0.05, 0.12),
      showGlow: bool(a.showGlow, d.appearance.showGlow),
      showNoise: bool(a.showNoise, d.appearance.showNoise)
    },
    widget: {
      enabled: bool(w.enabled, d.widget.enabled),
      alwaysOnTop: bool(w.alwaysOnTop, d.widget.alwaysOnTop),
      clickThrough: bool(w.clickThrough, d.widget.clickThrough),
      width: num(w.width, d.widget.width, 220, 560),
      scale: num(w.scale, d.widget.scale, 0.7, 1.8),
      position,
      showSparkline: bool(w.showSparkline, d.widget.showSparkline),
      showPeak: bool(w.showPeak, d.widget.showPeak),
      showAdapter: bool(w.showAdapter, d.widget.showAdapter)
    },
    monitor: {
      sampleMs: num(m.sampleMs, d.monitor.sampleMs, 250, 5e3),
      smoothing: num(m.smoothing, d.monitor.smoothing, 0.05, 1),
      unit: oneOf(m.unit, UNITS, d.monitor.unit),
      adapter: str(m.adapter, d.monitor.adapter),
      includeVirtual: bool(m.includeVirtual, d.monitor.includeVirtual),
      referenceMbps: num(m.referenceMbps, d.monitor.referenceMbps, 10, 1e4),
      paused: bool(m.paused, d.monitor.paused)
    },
    speedTest: {
      serverUrl: typeof s.serverUrl === "string" ? s.serverUrl.replace(/\/+$/, "") : d.speedTest.serverUrl,
      concurrency: Math.round(num(s.concurrency, d.speedTest.concurrency, 1, 16)),
      phaseDurationMs: Math.round(num(s.phaseDurationMs, d.speedTest.phaseDurationMs, 2e3, 6e4))
    },
    behaviour: {
      launchAtLogin: bool(b.launchAtLogin, d.behaviour.launchAtLogin),
      startHidden: bool(b.startHidden, d.behaviour.startHidden),
      minimizeToTray: bool(b.minimizeToTray, d.behaviour.minimizeToTray),
      notifyOnDrop: bool(b.notifyOnDrop, d.behaviour.notifyOnDrop),
      warnBelowMbps: num(b.warnBelowMbps, d.behaviour.warnBelowMbps, 1, 1e3)
    }
  };
}
function mergeSettings(base, patch) {
  const p = patch ?? {};
  return sanitizeSettings({
    ...base,
    appearance: { ...base.appearance, ...p.appearance },
    widget: { ...base.widget, ...p.widget },
    monitor: { ...base.monitor, ...p.monitor },
    speedTest: { ...base.speedTest, ...p.speedTest },
    behaviour: { ...base.behaviour, ...p.behaviour }
  });
}
function hexToRgb(hexValue) {
  const clean = hexValue.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const int = Number.parseInt(full, 16);
  if (!Number.isFinite(int)) return [34, 211, 238];
  return [int >> 16 & 255, int >> 8 & 255, int & 255];
}
var CHANNELS = {
  settingsGet: "ng:settings:get",
  settingsSet: "ng:settings:set",
  settingsChanged: "ng:settings:changed",
  sample: "ng:sample",
  adapters: "ng:adapters",
  setPaused: "ng:paused",
  windowAction: "ng:window",
  openView: "ng:open-view",
  openViewRequest: "ng:open-view-request",
  appInfo: "ng:app-info",
  loginItem: "ng:login-item",
  relaunchWindow: "ng:relaunch-window"
};

// src/main/ipc.ts
function registerIpc(deps) {
  import_electron.ipcMain.handle(CHANNELS.settingsGet, () => deps.store.get());
  import_electron.ipcMain.handle(
    CHANNELS.settingsSet,
    (_event, patch) => deps.store.update({ ...deps.store.get(), ...patch })
  );
  import_electron.ipcMain.handle(CHANNELS.adapters, () => deps.getAdapters());
  import_electron.ipcMain.handle(CHANNELS.setPaused, (_event, paused) => {
    deps.setPaused(Boolean(paused));
    return deps.store.get();
  });
  import_electron.ipcMain.handle(CHANNELS.windowAction, (event, action, value) => {
    deps.windowAction(action, value, import_electron.BrowserWindow.fromWebContents(event.sender) ?? void 0);
  });
  import_electron.ipcMain.handle(CHANNELS.openView, (_event, view) => deps.openView(view));
  import_electron.ipcMain.handle(CHANNELS.loginItem, (_event, enabled) => deps.setLoginItem(Boolean(enabled)));
  import_electron.ipcMain.handle(CHANNELS.relaunchWindow, () => deps.relaunchWindows());
  import_electron.ipcMain.handle(CHANNELS.appInfo, () => {
    const settings = deps.store.get();
    void settings;
    return {
      version: import_electron.app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron ?? "unknown",
      chrome: process.versions.chrome ?? "unknown",
      node: process.versions.node,
      isPackaged: import_electron.app.isPackaged,
      simulated: false
    };
  });
}

// src/main/sampler.ts
var import_node_child_process = require("node:child_process");
var import_promises = require("node:fs/promises");
var BLOCK_MARKER = "###";
function splitBlocks(buffer) {
  const parts = buffer.split(BLOCK_MARKER);
  const rest = parts.pop() ?? "";
  return { blocks: parts.filter((p) => p.trim().length > 0), rest };
}
function parseCounterBlock(block) {
  const out = [];
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [name, rx, tx] = trimmed.split("	");
    if (!name) continue;
    const rxBytes = Number(rx);
    const txBytes = Number(tx);
    if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue;
    out.push({ name: name.trim(), rxBytes, txBytes });
  }
  return out;
}
var POWERSHELL_LOOP = (intervalMs) => `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($true) {
  Get-NetAdapterStatistics | ForEach-Object { "{0}\`t{1}\`t{2}" -f $_.Name, $_.ReceivedBytes, $_.SentBytes }
  '${BLOCK_MARKER}'
  Start-Sleep -Milliseconds ${Math.max(100, Math.round(intervalMs))}
}`;
function createWindowsReader(intervalMs) {
  let child = null;
  let buffer = "";
  let pending = null;
  const queue = [];
  let disposed = false;
  const start = () => {
    if (disposed) return;
    child = (0, import_node_child_process.spawn)("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", POWERSHELL_LOOP(intervalMs)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"]
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      buffer += chunk;
      const { blocks, rest } = splitBlocks(buffer);
      buffer = rest;
      for (const block of blocks) {
        const counters = parseCounterBlock(block);
        if (pending) {
          const resolve = pending;
          pending = null;
          resolve(counters);
        } else {
          queue.push(counters);
          if (queue.length > 4) queue.shift();
        }
      }
    });
    child.on("exit", () => {
      child = null;
      if (!disposed) setTimeout(start, 1e3);
    });
    child.on("error", () => {
      child = null;
    });
  };
  start();
  return {
    kind: "Windows \xB7 Get-NetAdapterStatistics",
    read() {
      const queued = queue.shift();
      if (queued) return Promise.resolve(queued);
      if (!child) return Promise.resolve([]);
      return new Promise((resolve) => {
        pending = resolve;
        setTimeout(() => {
          if (pending === resolve) {
            pending = null;
            resolve([]);
          }
        }, 5e3);
      });
    },
    dispose() {
      disposed = true;
      child?.kill();
      child = null;
    }
  };
}
function createProcReader() {
  return {
    kind: "Linux \xB7 /proc/net/dev",
    async read() {
      const text = await (0, import_promises.readFile)("/proc/net/dev", "utf8");
      return parseProcNetDev(text);
    }
  };
}
function createNetstatIbReader() {
  return {
    kind: "macOS \xB7 netstat -ib",
    async read() {
      const { stdout } = await runCommand("netstat", ["-ib"]);
      return parseNetstatIb(stdout);
    }
  };
}
function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = (0, import_node_child_process.spawn)(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => {
      stdout += d;
    });
    child.stderr?.on("data", (d) => {
      stderr += d;
    });
    child.on("error", reject);
    child.on("close", () => resolve({ stdout, stderr }));
  });
}
function createReaderForPlatform(platform, intervalMs) {
  if (platform === "win32") return createWindowsReader(intervalMs);
  if (platform === "darwin") return createNetstatIbReader();
  return createProcReader();
}
var Sampler = class {
  constructor(options) {
    this.options = options;
  }
  timer = null;
  previous = [];
  previousAt = 0;
  hasPrevious = false;
  smoothDown = 0;
  smoothUp = 0;
  busy = false;
  stats = { samples: 0, dropped: 0 };
  get now() {
    return this.options.now ?? Date.now;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    void this.tick();
  }
  /** Stops polling but keeps the reader alive (used by "Pause monitoring"). */
  stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  /** Stops polling and releases the underlying reader (used on quit). */
  stop() {
    this.stopTimer();
    this.options.reader.dispose?.();
  }
  /** One-off counter read, used by the adapter picker in Studio. */
  readCounters() {
    return this.options.reader.read();
  }
  setOptions(options) {
    this.options = { ...this.options, ...options };
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    }
  }
  reset() {
    this.previous = [];
    this.previousAt = 0;
    this.hasPrevious = false;
    this.smoothDown = 0;
    this.smoothUp = 0;
  }
  async tick() {
    if (this.busy) {
      this.stats.dropped += 1;
      return null;
    }
    this.busy = true;
    try {
      const at = this.now();
      const counters = await this.options.reader.read();
      if (counters.length === 0) {
        this.stats.lastError = "no counters";
        return null;
      }
      const seconds = this.hasPrevious ? (at - this.previousAt) / 1e3 : 0;
      const filter = {
        only: this.options.adapter && this.options.adapter !== "auto" ? this.options.adapter : void 0,
        includeVirtual: this.options.includeVirtual
      };
      let sample;
      if (this.hasPrevious && seconds > 0) {
        const diff = diffCounters(this.previous, counters, seconds, filter);
        this.smoothDown = ema(this.smoothDown, diff.downBps, this.options.smoothing);
        this.smoothUp = ema(this.smoothUp, diff.upBps, this.options.smoothing);
        sample = {
          t: at,
          downBps: diff.downBps,
          upBps: diff.upBps,
          totalBps: diff.totalBps,
          smoothDownBps: this.smoothDown,
          smoothUpBps: this.smoothUp,
          rxBytes: diff.rxBytes,
          txBytes: diff.txBytes,
          interfaces: diff.interfaces
        };
        this.stats.samples += 1;
      } else {
        sample = {
          t: at,
          downBps: 0,
          upBps: 0,
          totalBps: 0,
          smoothDownBps: 0,
          smoothUpBps: 0,
          rxBytes: 0,
          txBytes: 0,
          interfaces: []
        };
      }
      this.previous = counters;
      this.previousAt = at;
      this.hasPrevious = true;
      this.options.onSample(sample);
      return sample;
    } catch (error) {
      this.stats.lastError = error instanceof Error ? error.message : String(error);
      return null;
    } finally {
      this.busy = false;
    }
  }
};

// src/main/settings.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function settingsPath(userDataDir) {
  return (0, import_node_path.join)(userDataDir, "netgauge-settings.json");
}
function loadSettings(file) {
  try {
    if (!(0, import_node_fs.existsSync)(file)) return { settings: DEFAULT_SETTINGS };
    const raw = (0, import_node_fs.readFileSync)(file, "utf8");
    if (!raw.trim()) return { settings: DEFAULT_SETTINGS };
    return { settings: sanitizeSettings(JSON.parse(raw)) };
  } catch (error) {
    return { settings: DEFAULT_SETTINGS, error: error instanceof Error ? error.message : String(error) };
  }
}
function saveSettings(file, settings) {
  const dir = (0, import_node_path.dirname)(file);
  if (!(0, import_node_fs.existsSync)(dir)) (0, import_node_fs.mkdirSync)(dir, { recursive: true });
  (0, import_node_fs.writeFileSync)(file, JSON.stringify(settings, null, 2), "utf8");
}
var SettingsStore = class {
  constructor(file, initial) {
    this.file = file;
    this.current = initial?.settings ?? loadSettings(file).settings;
  }
  current;
  listeners = /* @__PURE__ */ new Set();
  get() {
    return this.current;
  }
  get loadError() {
    return void 0;
  }
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  update(next) {
    this.current = sanitizeSettings(next);
    try {
      saveSettings(this.file, this.current);
    } catch {
    }
    for (const listener of this.listeners) listener(this.current);
    return this.current;
  }
};

// src/main/tray.ts
var import_electron2 = require("electron");
var ICON_SIZE = 16;
var MIN_REDRAW_MS = 220;
var NetGaugeTray = class {
  constructor(getSettings, actions) {
    this.getSettings = getSettings;
    this.actions = actions;
    this.create();
  }
  tray = null;
  lastDraw = 0;
  lastLevel = -1;
  create() {
    const image = this.render(0, false);
    this.tray = new import_electron2.Tray(image);
    this.tray.setToolTip("NetGauge \u2014 starting\u2026");
    this.tray.on("click", () => this.actions.openStudio());
    this.tray.on("double-click", () => this.actions.openStudio());
    this.rebuildMenu();
  }
  render(level, paused) {
    const { data, width, height } = renderTrayIcon({
      size: ICON_SIZE,
      scale: 2,
      accent: hexToRgb(this.getSettings().appearance.accent),
      level,
      mode: paused ? "paused" : "bars"
    });
    const image = import_electron2.nativeImage.createFromBuffer(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      width,
      height
    });
    if (process.platform === "darwin") image.setTemplateImage(true);
    return image;
  }
  update(sample) {
    if (!this.tray) return;
    const now = Date.now();
    if (now - this.lastDraw < MIN_REDRAW_MS) return;
    this.lastDraw = now;
    const settings = this.getSettings();
    const down = settings.monitor.paused ? 0 : sample.smoothDownBps;
    const up = settings.monitor.paused ? 0 : sample.smoothUpBps;
    const reference = Math.max(1, settings.monitor.referenceMbps) * 1e6;
    const level = Math.min(1, Math.sqrt(Math.max(down, up) / reference));
    if (Math.abs(level - this.lastLevel) > 0.02 || settings.monitor.paused) {
      this.lastLevel = level;
      this.tray.setImage(this.render(level, settings.monitor.paused));
    }
    this.tray.setToolTip(
      trayTooltip({
        down: formatSpeed(down, settings.monitor.unit).text,
        up: formatSpeed(up, settings.monitor.unit).text,
        iface: sample.interfaces[0],
        paused: settings.monitor.paused
      })
    );
  }
  rebuildMenu() {
    if (!this.tray) return;
    const settings = this.getSettings();
    const menu = import_electron2.Menu.buildFromTemplate([
      { label: "Open NetGauge", click: () => this.actions.openStudio() },
      { label: "Run speed test", click: () => this.actions.runSpeedTest() },
      { type: "separator" },
      {
        label: settings.widget.enabled ? "Hide widget" : "Show widget",
        click: () => this.actions.toggleWidget()
      },
      {
        label: settings.monitor.paused ? "Resume monitoring" : "Pause monitoring",
        click: () => this.actions.togglePaused()
      },
      {
        label: "Keep widget on top",
        type: "checkbox",
        checked: settings.widget.alwaysOnTop,
        click: () => this.actions.toggleAlwaysOnTop()
      },
      { type: "separator" },
      {
        label: "Units",
        submenu: ["bits", "bytes"].map((unit) => ({
          label: unit === "bits" ? "Megabits (Mbps)" : "Megabytes (MB/s)",
          type: "checkbox",
          checked: settings.monitor.unit === unit,
          click: () => this.actions.setUnit(unit)
        }))
      },
      {
        label: `Sampling every ${settings.monitor.sampleMs} ms`,
        enabled: false
      },
      { type: "separator" },
      {
        label: "Launch at login",
        type: "checkbox",
        checked: settings.behaviour.launchAtLogin,
        click: () => this.actions.toggleLoginItem()
      },
      { label: `NetGauge v${import_electron2.app.getVersion()}`, enabled: false },
      { type: "separator" },
      { label: "Quit", click: () => this.actions.quit() }
    ]);
    this.tray.setContextMenu(menu);
  }
  notify(title, body) {
    this.tray?.displayBalloon({ title, content: body });
  }
  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }
};

// src/main/windows.ts
var import_electron3 = require("electron");
var import_node_path2 = require("node:path");
var import_node_url = require("node:url");
var PRELOAD = (0, import_node_path2.join)(__dirname, "../preload/index.js");
var RENDERER_HTML = (0, import_node_path2.join)(__dirname, "../renderer/index.html");
function rendererUrl(view) {
  const dev = process.env.NETGAUGE_DEV_SERVER;
  return dev ? `${dev.replace(/\/$/, "")}/#${view}` : `${(0, import_node_url.pathToFileURL)(RENDERER_HTML).href}#/${view}`;
}
function materialFor(glass) {
  const systemVersion = process.getSystemVersion?.() ?? "";
  const major = Number.parseInt(systemVersion.split(".")[0] ?? "10", 10);
  const isWin11 = process.platform === "win32" && Number.isFinite(major) && major >= 11;
  if (process.platform === "win32" && isWin11) {
    if (glass === "acrylic") return { transparent: false, backgroundColor: "#00000000", backgroundMaterial: "acrylic" };
    if (glass === "mica") return { transparent: false, backgroundColor: "#00000000", backgroundMaterial: "mica" };
    if (glass === "solid") return { transparent: false, backgroundColor: "#0b1120" };
    return { transparent: false, backgroundColor: "#00000000", backgroundMaterial: "none" };
  }
  if (process.platform === "darwin" && glass !== "solid") {
    return { transparent: true, backgroundColor: "#00000000", vibrancy: "under-window" };
  }
  if (glass === "solid") return { transparent: false, backgroundColor: "#0b1120" };
  return { transparent: true, backgroundColor: "#00000000" };
}
var basePreferences = {
  preload: PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  spellcheck: false
};
function createStudioWindow(settings) {
  const material = materialFor(settings.appearance.glass);
  const win = new import_electron3.BrowserWindow({
    width: 1080,
    height: 740,
    minWidth: 880,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    ...material,
    webPreferences: basePreferences
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void import_electron3.shell.openExternal(url);
    return { action: "deny" };
  });
  void win.loadURL(rendererUrl("studio"));
  return win;
}
function createWidgetWindow(settings) {
  const material = materialFor(settings.appearance.glass);
  const width = Math.round(settings.widget.width * settings.widget.scale);
  const height = Math.round(230 * settings.widget.scale);
  const { workArea } = import_electron3.screen.getPrimaryDisplay();
  const win = new import_electron3.BrowserWindow({
    width,
    height,
    x: settings.widget.position?.x ?? workArea.x + workArea.width - width - 24,
    y: settings.widget.position?.y ?? workArea.y + 24,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: settings.widget.alwaysOnTop,
    ...material,
    webPreferences: { ...basePreferences }
  });
  win.setAlwaysOnTop(settings.widget.alwaysOnTop, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (settings.widget.clickThrough) win.setIgnoreMouseEvents(true, { forward: true });
  void win.loadURL(rendererUrl("widget"));
  return win;
}

// src/main/index.ts
var isWindows = process.platform === "win32";
var gotLock = import_electron4.app.requestSingleInstanceLock();
if (!gotLock) {
  import_electron4.app.quit();
} else {
  if (isWindows) import_electron4.app.commandLine.appendSwitch("disable-frame-rate-limit");
  let store;
  let sampler;
  let reader;
  let tray;
  let studio = null;
  let widget = null;
  let quitting = false;
  let lowSince = 0;
  let notified = false;
  const settings = () => store.get();
  const broadcastSample = (sample) => {
    for (const win of import_electron4.BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.sample, sample);
    }
    tray?.update(sample);
    watchForDrop(sample);
  };
  const watchForDrop = (sample) => {
    const s = settings();
    if (!s.behaviour.notifyOnDrop || s.monitor.paused) return;
    const threshold = s.behaviour.warnBelowMbps * 1e6;
    if (sample.smoothDownBps > 0 && sample.smoothDownBps < threshold) {
      if (lowSince === 0) lowSince = sample.t;
      if (!notified && sample.t - lowSince > 15e3) {
        notified = true;
        tray?.notify(
          "Connection looks slow",
          `Download has stayed under ${s.behaviour.warnBelowMbps} Mbps for 15 s (now ${formatSpeed(sample.smoothDownBps, s.monitor.unit).text}).`
        );
      }
    } else {
      lowSince = 0;
      notified = false;
    }
  };
  const setPaused = (paused) => {
    store.update(mergeSettings(settings(), { monitor: { paused } }));
    if (paused) {
      sampler.stopTimer();
      broadcastSample({
        t: Date.now(),
        downBps: 0,
        upBps: 0,
        totalBps: 0,
        smoothDownBps: 0,
        smoothUpBps: 0,
        rxBytes: 0,
        txBytes: 0,
        interfaces: []
      });
    } else {
      sampler.reset();
      sampler.start();
    }
    tray?.rebuildMenu();
  };
  const applyLoginItem = (enabled) => {
    store.update(mergeSettings(settings(), { behaviour: { launchAtLogin: enabled } }));
    if (isWindows || process.platform === "darwin") {
      import_electron4.app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: isWindows ? ["--hidden"] : []
      });
    }
    tray?.rebuildMenu();
  };
  const openView = (view) => {
    if (view === "widget") {
      ensureWidget();
      widget?.focus();
      return;
    }
    ensureStudio();
    studio?.webContents.send(CHANNELS.openViewRequest, view);
    studio?.show();
    studio?.focus();
  };
  const ensureStudio = () => {
    if (studio && !studio.isDestroyed()) return studio;
    studio = createStudioWindow(settings());
    studio.on("close", (event) => {
      if (settings().behaviour.minimizeToTray && !quitting) {
        event.preventDefault();
        studio?.hide();
      }
    });
    studio.on("closed", () => {
      studio = null;
    });
    return studio;
  };
  const ensureWidget = () => {
    if (!settings().widget.enabled) return null;
    if (widget && !widget.isDestroyed()) return widget;
    widget = createWidgetWindow(settings());
    widget.on("moved", () => {
      if (!widget || widget.isDestroyed()) return;
      const [x, y] = widget.getPosition();
      store.update(mergeSettings(settings(), { widget: { position: { x, y } } }));
    });
    widget.on("closed", () => {
      widget = null;
    });
    return widget;
  };
  const destroyWindows = () => {
    for (const win of [studio, widget]) {
      if (win && !win.isDestroyed()) win.destroy();
    }
    studio = null;
    widget = null;
  };
  const windowAction = (action, value, win) => {
    const target = win ?? studio;
    switch (action) {
      case "minimize":
        target?.minimize();
        break;
      case "hide":
        target?.hide();
        break;
      case "close":
        if (settings().behaviour.minimizeToTray && !quitting) target?.hide();
        else target?.close();
        break;
      case "always-on-top": {
        const enabled = value ?? !(target?.isAlwaysOnTop() ?? false);
        target?.setAlwaysOnTop(enabled, "screen-saver");
        if (target === widget) store.update(mergeSettings(settings(), { widget: { alwaysOnTop: enabled } }));
        tray?.rebuildMenu();
        break;
      }
    }
  };
  const relaunchWindows = () => {
    const showStudio = studio !== null && !studio.isDestroyed();
    const showWidget = widget !== null && !widget.isDestroyed();
    destroyWindows();
    if (showStudio) openView("studio");
    if (showWidget) ensureWidget();
  };
  import_electron4.app.on("second-instance", () => openView("studio"));
  import_electron4.app.whenReady().then(() => {
    const file = settingsPath(import_electron4.app.getPath("userData"));
    const loaded = loadSettings(file);
    store = new SettingsStore(file, loaded);
    if (loaded.error) console.warn(`[NetGauge] Reset corrupt settings: ${loaded.error}`);
    const initial = settings();
    reader = createReaderForPlatform(process.platform, initial.monitor.sampleMs);
    sampler = new Sampler({
      reader,
      intervalMs: initial.monitor.sampleMs,
      adapter: initial.monitor.adapter,
      includeVirtual: initial.monitor.includeVirtual,
      smoothing: initial.monitor.smoothing,
      onSample: broadcastSample
    });
    tray = new NetGaugeTray(settings, {
      openStudio: () => openView("studio"),
      runSpeedTest: () => openView("test"),
      toggleWidget: () => {
        const enabled = !settings().widget.enabled;
        store.update(mergeSettings(settings(), { widget: { enabled } }));
        if (enabled) ensureWidget();
        else widget?.close();
        tray?.rebuildMenu();
      },
      togglePaused: () => setPaused(!settings().monitor.paused),
      setUnit: (unit) => {
        store.update(mergeSettings(settings(), { monitor: { unit } }));
        tray?.rebuildMenu();
      },
      toggleAlwaysOnTop: () => windowAction("always-on-top", !settings().widget.alwaysOnTop, widget ?? void 0),
      toggleLoginItem: () => applyLoginItem(!settings().behaviour.launchAtLogin),
      quit: () => {
        quitting = true;
        import_electron4.app.quit();
      }
    });
    registerIpc({
      store,
      getAdapters: async () => {
        const counters = await sampler.readCounters();
        return counters.map((c) => ({ name: c.name, rxBytes: c.rxBytes, txBytes: c.txBytes }));
      },
      setPaused,
      windowAction,
      openView,
      setLoginItem: applyLoginItem,
      relaunchWindows
    });
    store.onChange((next) => {
      for (const win of import_electron4.BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(CHANNELS.settingsChanged, next);
      }
      if (widget && !widget.isDestroyed()) {
        widget.setAlwaysOnTop(next.widget.alwaysOnTop, "screen-saver");
        widget.setIgnoreMouseEvents(next.widget.clickThrough, { forward: true });
        const width = Math.round(next.widget.width * next.widget.scale);
        widget.setSize(width, Math.round(230 * next.widget.scale));
      }
      sampler.setOptions({
        intervalMs: next.monitor.sampleMs,
        adapter: next.monitor.adapter,
        includeVirtual: next.monitor.includeVirtual,
        smoothing: next.monitor.smoothing
      });
      tray?.rebuildMenu();
    });
    if (isWindows || process.platform === "darwin") {
      const actual = import_electron4.app.getLoginItemSettings().openAtLogin;
      if (actual !== initial.behaviour.launchAtLogin) {
        store.update(mergeSettings(initial, { behaviour: { launchAtLogin: actual } }));
      }
    }
    if (!initial.monitor.paused) sampler.start();
    const hidden = process.argv.includes("--hidden") || initial.behaviour.startHidden;
    if (!hidden) openView("studio");
    ensureWidget();
  });
  import_electron4.app.on("window-all-closed", () => {
    if (!isWindows && !quitting) return;
  });
  import_electron4.app.on("before-quit", () => {
    quitting = true;
    sampler?.stop();
    tray?.destroy();
  });
  import_electron4.app.on("activate", () => openView("studio"));
}
