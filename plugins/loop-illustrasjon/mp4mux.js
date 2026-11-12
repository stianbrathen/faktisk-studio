// Loop-illustrasjon · enkel MP4-pakker for H.264 fra WebCodecs (bare i editoren, ikke i embed)
//
// Én videospor, ingen lyd, ingen B-bilder (baseline). Bildene samles i minnet, og filen bygges
// som ftyp + mdat + moov når alt er kodet. Holder lenge for loop-lengder på noen sekunder.
class FliMp4 {
  constructor(width, height, fps) {
    this.w = width; this.h = height; this.fps = fps;
    this.timescale = fps * 1000; this.chunks = []; this.avcC = null;
  }
  add(chunk, meta) {
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.avcC) {
      const d = meta.decoderConfig.description;
      this.avcC = new Uint8Array(d.buffer ? d.buffer.slice(d.byteOffset || 0, (d.byteOffset || 0) + d.byteLength) : d);
    }
    const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
    this.chunks.push({ data, key: chunk.type === 'key' });
  }
  finish() {
    if (!this.avcC) throw new Error('Mangler avcC fra koderen');
    const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const u16 = n => [(n >>> 8) & 255, n & 255];
    const str = s => Array.from(s).map(c => c.charCodeAt(0));
    const box = (type, ...parts) => {
      const body = []; parts.forEach(p => { if (p instanceof Uint8Array) body.push(p); else body.push(Uint8Array.from(p)); });
      const len = 8 + body.reduce((a, b) => a + b.length, 0), out = new Uint8Array(len);
      out.set(u32(len), 0); out.set(str(type), 4); let o = 8; body.forEach(b => { out.set(b, o); o += b.length; }); return out;
    };
    const full = (type, ver, flags, ...parts) => box(type, [ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
    const n = this.chunks.length, dur = n * 1000;   // timescale = fps*1000, hvert bilde = 1000
    const matrix = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0];
    const ftyp = box('ftyp', str('isom'), u32(512), str('isomiso2avc1mp41'));
    const mdatLen = 8 + this.chunks.reduce((a, c) => a + c.data.length, 0);
    const mdatHead = Uint8Array.from([...u32(mdatLen), ...str('mdat')]);
    const firstOffset = ftyp.length + 8;
    const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(this.timescale), u32(dur), u32(0x00010000), u16(0x0100), new Array(10).fill(0), matrix, new Array(24).fill(0), u32(2));
    const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(dur), new Array(8).fill(0), u16(0), u16(0), u16(0), u16(0), matrix, u32(this.w << 16), u32(this.h << 16));
    const mdhd = full('mdhd', 0, 0, u32(0), u32(0), u32(this.timescale), u32(dur), u16(0x55c4), u16(0));
    const hdlr = full('hdlr', 0, 0, u32(0), str('vide'), new Array(12).fill(0), str('VideoHandler'), [0]);
    const vmhd = full('vmhd', 0, 1, new Array(8).fill(0));
    const dinf = box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)));
    const avc1 = box('avc1', new Array(6).fill(0), u16(1), new Array(16).fill(0), u16(this.w), u16(this.h), u32(0x00480000), u32(0x00480000), u32(0), u16(1),
      new Array(32).fill(0), u16(0x0018), u16(0xffff), box('avcC', this.avcC));
    const stsd = full('stsd', 0, 0, u32(1), avc1);
    const stts = full('stts', 0, 0, u32(1), u32(n), u32(1000));
    const keys = []; this.chunks.forEach((c, i) => { if (c.key) keys.push(i + 1); });
    const stss = full('stss', 0, 0, u32(keys.length), ...keys.map(u32));
    const stsc = full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1));
    const stsz = full('stsz', 0, 0, u32(0), u32(n), ...this.chunks.map(c => u32(c.data.length)));
    let off = firstOffset; const offs = this.chunks.map(c => { const o = off; off += c.data.length; return o; });
    if (off > 0xffffffff) throw new Error('Filen ble over 4 GB');
    // ett bilde per «chunk» gjør stco enkel
    const stsc2 = full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1));
    const stco = full('stco', 0, 0, u32(n), ...offs.map(u32));
    void stsc;
    const stbl = box('stbl', stsd, stts, stss, stsc2, stsz, stco);
    const minf = box('minf', vmhd, dinf, stbl);
    const mdia = box('mdia', mdhd, hdlr, minf);
    const trak = box('trak', tkhd, mdia);
    const moov = box('moov', mvhd, trak);
    return new Blob([ftyp, mdatHead, ...this.chunks.map(c => c.data), moov], { type: 'video/mp4' });
  }
}
