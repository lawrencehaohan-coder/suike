/*! Shape-matched optics from LeonardSEO/liquid-glass-react, Copyright (c) 2026 Leonard van Hemert, MIT. Full license and pinned source in vendor/liquid-glass-optics/. */
var SuikeGlassOpticsBundle = (() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // work/android-app/vendor/liquid-glass-optics/src/maps.ts
  var maps_exports = {};
  __export(maps_exports, {
    buildDisplacementMap: () => buildDisplacementMap,
    buildInteriorMask: () => buildInteriorMask,
    buildSpecularMap: () => buildSpecularMap,
    clampShape: () => clampShape,
    imageDataToUrl: () => imageDataToUrl,
    refractionProfile: () => refractionProfile
  });
  var SAMPLES = 256;
  function profileHeight(profile, t) {
    t = Math.min(1, Math.max(0, t));
    const convexSquircle = Math.pow(1 - Math.pow(1 - t, 4), 1 / 4);
    switch (profile) {
      case "circle":
        return Math.sqrt(1 - (1 - t) * (1 - t));
      case "lip": {
        const s = t * t * t * (t * (t * 6 - 15) + 10);
        return convexSquircle * (1 - s) + (1 - convexSquircle * 0.35) * s;
      }
      default:
        return convexSquircle;
    }
  }
  function refractionProfile({ bezel, thickness, ior, profile }) {
    if (!Number.isFinite(bezel) || bezel <= 0 || !Number.isFinite(thickness) || thickness < 0 || !Number.isFinite(ior) || ior <= 0) {
      throw new RangeError("Glass optics require a finite positive bezel and ior, and a finite non-negative thickness");
    }
    const out = new Float32Array(SAMPLES);
    const eta = 1 / ior;
    const h = 1e-3;
    for (let i = 0; i < SAMPLES; i++) {
      const t = (i + 0.5) / SAMPLES;
      const z = profileHeight(profile, t) * thickness;
      const slope = (profileHeight(profile, t + h) - profileHeight(profile, t - h)) / (2 * h) * (thickness / bezel);
      const inv = 1 / Math.hypot(slope, 1);
      const nx = -slope * inv;
      const nz = inv;
      const cosi = nz;
      const k = 1 - eta * eta * (1 - cosi * cosi);
      if (k < 0) {
        out[i] = 0;
        continue;
      }
      const f = eta * cosi - Math.sqrt(k);
      const tx = f * nx;
      const tz = -eta + f * nz;
      out[i] = tx / -tz * z;
    }
    return out;
  }
  function roundedRectField(px, py, w, h, r, f) {
    const hw = w / 2;
    const hh = h / 2;
    const dx = px - hw;
    const dy = py - hh;
    const sx = dx < 0 ? -1 : 1;
    const sy = dy < 0 ? -1 : 1;
    const qx = Math.abs(dx) - (hw - r);
    const qy = Math.abs(dy) - (hh - r);
    if (qx > 0 && qy > 0) {
      const len = Math.hypot(qx, qy);
      f.dist = r - len;
      f.nx = sx * qx / len;
      f.ny = sy * qy / len;
    } else if (qx > qy) {
      f.dist = r - qx;
      f.nx = sx;
      f.ny = 0;
    } else {
      f.dist = r - qy;
      f.nx = 0;
      f.ny = sy;
    }
  }
  function clampShape(shape) {
    const width = Math.max(1, Math.round(shape.width));
    const height = Math.max(1, Math.round(shape.height));
    return { width, height, radius: Math.min(shape.radius, width / 2, height / 2) };
  }
  function buildDisplacementMap(shape, optics) {
    const { width, height, radius } = clampShape(shape);
    const bezel = Math.max(1, Math.min(optics.bezel, width / 2, height / 2));
    const profile = refractionProfile(__spreadProps(__spreadValues({}, optics), { bezel }));
    let max = 0;
    for (let i = 0; i < profile.length; i++) max = Math.max(max, Math.abs(profile[i]));
    max = max || 1;
    const data = new Uint8ClampedArray(width * height * 4);
    const f = { dist: 0, nx: 0, ny: 0 };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        roundedRectField(x + 0.5, y + 0.5, width, height, radius, f);
        let vx = 0;
        let vy = 0;
        if (f.dist >= 0 && f.dist < bezel) {
          const s = profile[Math.min(SAMPLES - 1, Math.floor(f.dist / bezel * SAMPLES))] / max;
          vx = -f.nx * s;
          vy = -f.ny * s;
        }
        data[o] = 128 + vx * 127;
        data[o + 1] = 128 + vy * 127;
        data[o + 2] = 128;
        data[o + 3] = 255;
      }
    }
    return { data, width, height, scale: max * 2 };
  }
  function buildSpecularMap(shape, opts, dpr = 1) {
    const { width, height, radius } = clampShape(shape);
    const W = Math.round(width * dpr);
    const H = Math.round(height * dpr);
    const img = new ImageData(W, H);
    const d = img.data;
    const cutoff = Math.max(opts.rimWidth * 6, opts.glowWidth * 3.5);
    const lx = Math.cos(opts.angle * Math.PI / 180);
    const ly = Math.sin(opts.angle * Math.PI / 180);
    const f = { dist: 0, nx: 0, ny: 0 };
    const R = Math.max(cutoff, radius) * dpr;
    const skipY0 = cutoff * dpr;
    const skipY1 = H - cutoff * dpr;
    for (let y = 0; y < H; y++) {
      const rowSkip = y > skipY0 && y < skipY1;
      for (let x = 0; x < W; x++) {
        if (rowSkip && x > R && x < W - R) {
          x = Math.floor(W - R);
          continue;
        }
        roundedRectField((x + 0.5) / dpr, (y + 0.5) / dpr, width, height, radius, f);
        if (f.dist < 0 || f.dist > cutoff) continue;
        const facing = f.nx * lx + f.ny * ly;
        const lit = Math.pow(Math.abs(facing), 1.6);
        const directional = facing < 0 ? lit : lit * 0.7;
        const ambient = 0.3;
        const line = Math.exp(-Math.pow(f.dist / opts.rimWidth, 2));
        const inner = Math.exp(-Math.pow((f.dist - opts.rimWidth * 2.2) / opts.rimWidth, 2)) * 0.35;
        const glow = Math.exp(-f.dist / opts.glowWidth) * (0.06 + 0.3 * directional);
        const aa = Math.min(1, f.dist * dpr + 0.5);
        const a = ((line + inner) * (ambient + directional * 0.7) + glow) * aa;
        const o = (y * W + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = 255;
        d[o + 3] = Math.min(255, a * 255);
      }
    }
    return img;
  }
  function imageDataToUrl(data) {
    const canvas = document.createElement("canvas");
    canvas.width = data.width;
    canvas.height = data.height;
    const ctx = canvas.getContext("2d");
    const img = data instanceof ImageData ? data : new ImageData(data.data, data.width, data.height);
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  }
  function buildInteriorMask(shape, bezel, dpr = 1) {
    const { width, height, radius } = clampShape(shape);
    bezel = Math.max(1, Math.min(bezel, width / 2, height / 2));
    const W = Math.round(width * dpr);
    const H = Math.round(height * dpr);
    const img = new ImageData(W, H);
    const d = img.data;
    const f = { dist: 0, nx: 0, ny: 0 };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        roundedRectField((x + 0.5) / dpr, (y + 0.5) / dpr, width, height, radius, f);
        const t = Math.min(1, Math.max(0, f.dist / bezel));
        const s = t * t * (3 - 2 * t);
        const o = (y * W + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = 255;
        d[o + 3] = (0.25 + 0.75 * s) * 255;
      }
    }
    return img;
  }
  return __toCommonJS(maps_exports);
})();

window.SuikeGlassOptics=SuikeGlassOpticsBundle;
