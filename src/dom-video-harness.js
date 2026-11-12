// Faktisk Studio · virtuell klokke for video-eksport av HTML-embeds
//
// Lastes FØR embed-koden i eksportsiden. Erstatter setTimeout/setInterval/
// requestAnimationFrame/performance.now/Date.now og IntersectionObserver,
// og fryser alle CSS-animasjoner og -overganger. __fkVT.step(ms) flytter
// klokka fram: timere kjøres i riktig rekkefølge og hver animasjon settes
// til nøyaktig riktig tidspunkt. Da blir hver videoramme eksakt — uansett
// hvor lang tid det tar å ta bildet av den.
//
// Eksporteres som tekst (HARNESS) og legges inline i eksportsiden.

const HARNESS = String.raw`(function () {
  var realST = window.setTimeout.bind(window);
  var realRAF = window.requestAnimationFrame.bind(window);
  var now = 0, seq = 0, timers = [], rafs = [];
  var started = new Map();

  window.setTimeout = function (fn, ms) {
    var a = [].slice.call(arguments, 2), id = ++seq;
    timers.push({ id: id, t: now + Math.max(0, +ms || 0), fn: fn, args: a });
    return id;
  };
  window.setInterval = function (fn, ms) {
    var a = [].slice.call(arguments, 2), id = ++seq, every = Math.max(1, +ms || 0);
    timers.push({ id: id, t: now + every, fn: fn, args: a, every: every });
    return id;
  };
  window.clearTimeout = window.clearInterval = function (id) {
    timers = timers.filter(function (x) { return x.id !== id; });
  };
  window.requestAnimationFrame = function (fn) { var id = ++seq; rafs.push({ id: id, fn: fn }); return id; };
  window.cancelAnimationFrame = function (id) { rafs = rafs.filter(function (x) { return x.id !== id; }); };
  var d0 = Date.now();
  performance.now = function () { return now; };
  Date.now = function () { return d0 + now; };

  // Alt er «synlig» med en gang: embeds som venter på scroll starter ved t=0
  function FakeIO(cb) { this.cb = cb; this.off = false; }
  FakeIO.prototype.observe = function (el) {
    var self = this;
    window.setTimeout(function () {
      if (self.off) return;
      var r = el.getBoundingClientRect();
      self.cb([{ target: el, isIntersecting: true, intersectionRatio: 1, boundingClientRect: r,
                 intersectionRect: r, rootBounds: null, time: now }], self);
    }, 0);
  };
  FakeIO.prototype.unobserve = function () {};
  FakeIO.prototype.disconnect = function () { this.off = true; };
  FakeIO.prototype.takeRecords = function () { return []; };
  window.IntersectionObserver = FakeIO;

  // Frys alle CSS-animasjoner/-overganger og sett dem til riktig tid
  function sync() {
    var list = document.getAnimations ? document.getAnimations() : [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!started.has(a)) started.set(a, now);
      try { a.pause(); a.currentTime = Math.max(0, now - started.get(a)); } catch (e) {}
    }
  }

  function settle() {
    return new Promise(function (res) {
      var done = false, fin = function () { if (!done) { done = true; res(true); } };
      realRAF(function () { realRAF(fin); });
      realST(fin, 250);
    });
  }

  window.__fkVT = {
    ready: function () {
      [].forEach.call(document.querySelectorAll('img[loading]'), function (im) { im.loading = 'eager'; });
      var imgs = [].map.call(document.images, function (im) {
        if (im.complete) return 1;
        return new Promise(function (r) { im.addEventListener('load', r); im.addEventListener('error', r); realST(r, 10000); });
      });
      var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : 1;
      return Promise.all([fonts].concat(imgs)).then(function () { sync(); return settle(); });
    },
    step: function (t) {
      var guard = 0;
      while (guard++ < 100000) {
        timers.sort(function (a, b) { return a.t - b.t || a.id - b.id; });
        var x = timers[0];
        if (!x || x.t > t) break;
        var ft = x.t;
        if (x.every) x.t = ft + x.every; else timers.shift();
        now = Math.max(now, ft);
        sync();                       // stilene må stå riktig FØR endringen (overganger starter derfra)
        try { x.fn.apply(window, x.args); } catch (e) { console.error(e); }
        sync();
      }
      now = Math.max(now, t);
      var r = rafs; rafs = [];
      r.forEach(function (f) { try { f.fn(now); } catch (e) { console.error(e); } });
      sync();
      return settle();
    },
    size: function () {
      var el = document.getElementById('fk-stage');
      var r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    },
  };
})();`;

module.exports = { HARNESS };
