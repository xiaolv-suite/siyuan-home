/**
 * 零外部依赖 QR 标签生成（ISO/IEC 18004 Byte 模式 · 纠错等级 M · Version 1–14）。
 *
 * 与 lunar-lazy.ts 同理：剥离 84KB 的通用 CJS qrcode + dijkstrajs 依赖（含 Kanji 字典与多端渲染器），
 * 仅保留台账标签与深链分享所需的标准 UTF-8 Byte 模式矩阵编码与 1-bit PNG 输出，单文件体积净省 ~14KB gzip。
 * 矩阵位级正确性由 tests/core/qr.test.ts 与参考库逐模块对齐守护。
 */

// Version 1..14 总码字数、M 级纠错码字总数、块数、Version>=7 的 18-bit 版本信息
const TOTAL_CW = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581];
const EC_TOTAL = [0, 10, 16, 26, 36, 48, 64, 72, 88, 110, 130, 150, 176, 198, 216];
const EC_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9];
const VER_BITS = [0, 0, 0, 0, 0, 0, 0, 31892, 34236, 39577, 42195, 48118, 51042, 55367, 58893];
const FMT_BITS_M = [21522, 20773, 24188, 23371, 17913, 16590, 20375, 19104];
const ALIGN_COORDS: number[][] = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
];

// GF(256) 指数/对数表（本原多项式 0x11d）
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsEncode(data: Uint8Array, degree: number): Uint8Array {
    let gen = new Uint8Array([1]);
    for (let i = 0; i < degree; i++) {
        const next = new Uint8Array(gen.length + 1);
        for (let j = 0; j < gen.length; j++) {
            next[j] ^= gen[j];
            next[j + 1] ^= gfMul(gen[j], EXP[i]);
        }
        gen = next;
    }
    const rem = new Uint8Array(data.length + degree);
    rem.set(data);
    for (let i = 0; i < data.length; i++) {
        const factor = rem[i];
        if (factor !== 0) {
            for (let j = 0; j < gen.length; j++) rem[i + j] ^= gfMul(gen[j], factor);
        }
    }
    return rem.slice(data.length);
}

function buildCodewords(bytes: Uint8Array, ver: number): Uint8Array {
    const totalCw = TOTAL_CW[ver];
    const ecTotal = EC_TOTAL[ver];
    const dataCw = totalCw - ecTotal;
    const totalBits = dataCw * 8;
    const countBits = ver < 10 ? 8 : 16;

    const bits: number[] = [];
    const pushBits = (val: number, len: number) => {
        for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };
    pushBits(0b0100, 4); // Byte mode
    pushBits(bytes.length, countBits);
    for (let i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);
    if (bits.length + 4 <= totalBits) pushBits(0, 4);
    while (bits.length % 8 !== 0) bits.push(0);

    const dataBuf = new Uint8Array(dataCw);
    for (let i = 0; i < bits.length / 8; i++) {
        let b = 0;
        for (let k = 0; k < 8; k++) b = (b << 1) | bits[i * 8 + k];
        dataBuf[i] = b;
    }
    for (let i = bits.length / 8, p = 0; i < dataCw; i++, p++) {
        dataBuf[i] = p % 2 ? 0x11 : 0xec;
    }

    const blocks = EC_BLOCKS[ver];
    const g2 = totalCw % blocks;
    const g1 = blocks - g2;
    const cwG1 = Math.floor(totalCw / blocks);
    const dcG1 = Math.floor(dataCw / blocks);
    const ecCount = cwG1 - dcG1;

    const dc: Uint8Array[] = [];
    const ec: Uint8Array[] = [];
    let offset = 0;
    let maxDc = 0;
    for (let b = 0; b < blocks; b++) {
        const len = b < g1 ? dcG1 : dcG1 + 1;
        const slice = dataBuf.slice(offset, offset + len);
        dc.push(slice);
        ec.push(rsEncode(slice, ecCount));
        offset += len;
        if (len > maxDc) maxDc = len;
    }

    const out = new Uint8Array(totalCw);
    let idx = 0;
    for (let i = 0; i < maxDc; i++) {
        for (let b = 0; b < blocks; b++) if (i < dc[b].length) out[idx++] = dc[b][i];
    }
    for (let i = 0; i < ecCount; i++) {
        for (let b = 0; b < blocks; b++) out[idx++] = ec[b][i];
    }
    return out;
}

function maskBit(mask: number, r: number, c: number): boolean {
    switch (mask) {
        case 0: return (r + c) % 2 === 0;
        case 1: return r % 2 === 0;
        case 2: return c % 3 === 0;
        case 3: return (r + c) % 3 === 0;
        case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
        case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
        case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
        default: return (((r * c) % 3) + ((r + c) % 2)) % 2 === 0;
    }
}

function writeFormatBits(data: Uint8Array, res: Uint8Array, size: number, mask: number): void {
    const bits = FMT_BITS_M[mask];
    const set = (r: number, c: number, v: number) => { data[r * size + c] = v; res[r * size + c] = 1; };
    for (let i = 0; i < 15; i++) {
        const mod = (bits >> i) & 1;
        set(i < 6 ? i : i < 8 ? i + 1 : size - 15 + i, 8, mod);
        set(8, i < 8 ? size - i - 1 : i < 9 ? 15 - i : 14 - i, mod);
    }
    set(size - 8, 8, 1);
}

function penaltyScore(d: Uint8Array, size: number): number {
    let score = 0;
    for (let r = 0; r < size; r++) {
        let cRow = 0, cCol = 0, lRow = -1, lCol = -1, bRow = 0, bCol = 0;
        for (let c = 0; c < size; c++) {
            const vr = d[r * size + c];
            if (vr === lRow) cRow++; else { if (cRow >= 5) score += 3 + (cRow - 5); lRow = vr; cRow = 1; }
            bRow = ((bRow << 1) & 0x7ff) | vr;
            if (c >= 10 && (bRow === 0x5d0 || bRow === 0x05d)) score += 40;

            const vc = d[c * size + r];
            if (vc === lCol) cCol++; else { if (cCol >= 5) score += 3 + (cCol - 5); lCol = vc; cCol = 1; }
            bCol = ((bCol << 1) & 0x7ff) | vc;
            if (c >= 10 && (bCol === 0x5d0 || bCol === 0x05d)) score += 40;
        }
        if (cRow >= 5) score += 3 + (cRow - 5);
        if (cCol >= 5) score += 3 + (cCol - 5);
    }
    for (let r = 0; r < size - 1; r++) {
        for (let c = 0; c < size - 1; c++) {
            const s = d[r * size + c] + d[r * size + c + 1] + d[(r + 1) * size + c] + d[(r + 1) * size + c + 1];
            if (s === 0 || s === 4) score += 3;
        }
    }
    let dark = 0;
    for (let i = 0; i < d.length; i++) dark += d[i];
    score += Math.abs(Math.ceil((dark * 100 / d.length) / 5) - 10) * 10;
    return score;
}

/** 生成标准 QR 矩阵（1 = 深色模块，0 = 浅色模块） */
export function encodeQrMatrix(text: string): { size: number; data: Uint8Array } {
    if (!text) throw new Error("QR text required");
    const bytes = new TextEncoder().encode(text);
    let ver = 0;
    for (let v = 1; v <= 14; v++) {
        const capBits = (TOTAL_CW[v] - EC_TOTAL[v]) * 8;
        const needBits = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
        if (needBits <= capBits) { ver = v; break; }
    }
    if (!ver) throw new Error("QR payload exceeds Version 14 capacity");

    const size = ver * 4 + 17;
    const base = new Uint8Array(size * size);
    const res = new Uint8Array(size * size);
    const setR = (r: number, c: number, v: boolean) => { base[r * size + c] = v ? 1 : 0; res[r * size + c] = 1; };

    // Finder patterns + separators
    for (const [fr, fc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
        for (let r = -1; r <= 7; r++) {
            if (fr + r < 0 || fr + r >= size) continue;
            for (let c = -1; c <= 7; c++) {
                if (fc + c < 0 || fc + c >= size) continue;
                const on = (r >= 0 && r <= 6 && (c === 0 || c === 6))
                    || (c >= 0 && c <= 6 && (r === 0 || r === 6))
                    || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
                setR(fr + r, fc + c, on);
            }
        }
    }
    // Timing patterns
    for (let r = 8; r < size - 8; r++) {
        setR(r, 6, r % 2 === 0);
        setR(6, r, r % 2 === 0);
    }
    // Alignment patterns
    const coords = ALIGN_COORDS[ver];
    for (let i = 0; i < coords.length; i++) {
        for (let j = 0; j < coords.length; j++) {
            if ((i === 0 && j === 0) || (i === 0 && j === coords.length - 1) || (i === coords.length - 1 && j === 0)) continue;
            const ar = coords[i], ac = coords[j];
            for (let r = -2; r <= 2; r++) {
                for (let c = -2; c <= 2; c++) {
                    setR(ar + r, ac + c, Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0));
                }
            }
        }
    }
    writeFormatBits(base, res, size, 0);
    if (ver >= 7) {
        const vb = VER_BITS[ver];
        for (let i = 0; i < 18; i++) {
            const r = Math.floor(i / 3), c = (i % 3) + size - 11, v = ((vb >> i) & 1) === 1;
            setR(r, c, v);
            setR(c, r, v);
        }
    }

    // Zigzag data placement
    const codewords = buildCodewords(bytes, ver);
    let inc = -1, row = size - 1, bitIdx = 7, byteIdx = 0;
    for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        while (true) {
            for (let c = 0; c < 2; c++) {
                const idx = row * size + (col - c);
                if (!res[idx]) {
                    base[idx] = byteIdx < codewords.length ? (codewords[byteIdx] >>> bitIdx) & 1 : 0;
                    if (--bitIdx < 0) { byteIdx++; bitIdx = 7; }
                }
            }
            row += inc;
            if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
        }
    }

    // Pick lowest-penalty mask (0..7)
    let bestData = base;
    let bestPenalty = Infinity;
    for (let m = 0; m < 8; m++) {
        const cand = base.slice();
        for (let r = 0; r < size; r++) {
            for (let c = 0; c < size; c++) {
                const idx = r * size + c;
                if (!res[idx] && maskBit(m, r, c)) cand[idx] ^= 1;
            }
        }
        writeFormatBits(cand, res, size, m);
        const p = penaltyScore(cand, size);
        if (p < bestPenalty) { bestPenalty = p; bestData = cand; }
    }
    return { size, data: bestData };
}

// CRC32 与 Adler32（供无损 1-bit 灰度 PNG 输出）
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c;
    }
    return t;
})();

function pngChunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    let crc = 0xffffffff;
    for (let i = 4; i < 8 + data.length; i++) crc = CRC_TABLE[(crc ^ out[i]) & 0xff] ^ (crc >>> 8);
    dv.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
    return out;
}

function toBase64(bytes: Uint8Array): string {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

/** 生成 QR PNG data URL（尺寸可配，默认 256px 适合打印标签；黑白高对比保证扫码可靠） */
export async function generateQRDataUrl(text: string, size = 256): Promise<string> {
    const qr = encodeQrMatrix(text);
    const margin = 2;
    const modules = qr.size + margin * 2;
    const scale = Math.max(1, Math.floor(size / modules));
    const dim = modules * scale;
    const rowBytes = 1 + Math.ceil(dim / 8); // filter byte 0 + 1-bit grayscale pixels (0=black, 1=white)
    const raw = new Uint8Array(rowBytes * dim);

    for (let y = 0; y < dim; y++) {
        const mr = Math.floor(y / scale) - margin;
        const rowOff = y * rowBytes + 1;
        raw.fill(0xff, rowOff, rowOff + rowBytes - 1);
        if (mr < 0 || mr >= qr.size) continue;
        for (let x = 0; x < dim; x++) {
            const mc = Math.floor(x / scale) - margin;
            if (mc >= 0 && mc < qr.size && qr.data[mr * qr.size + mc]) {
                raw[rowOff + (x >> 3)] &= ~(0x80 >>> (x & 7));
            }
        }
    }

    // Zlib stored deflate blocks (max 65535 bytes per block) + Adler-32
    const maxBlk = 65535;
    const numBlk = Math.max(1, Math.ceil(raw.length / maxBlk));
    const z = new Uint8Array(2 + raw.length + numBlk * 5 + 4);
    z[0] = 0x78; z[1] = 0x01;
    let zp = 2, s1 = 1, s2 = 0;
    for (let i = 0; i < raw.length; i++) {
        s1 = (s1 + raw[i]) % 65521;
        s2 = (s2 + s1) % 65521;
    }
    for (let b = 0; b < numBlk; b++) {
        const start = b * maxBlk;
        const slice = raw.subarray(start, Math.min(raw.length, start + maxBlk));
        const len = slice.length;
        z[zp++] = b === numBlk - 1 ? 1 : 0;
        z[zp++] = len & 0xff; z[zp++] = (len >>> 8) & 0xff;
        const nlen = (~len) & 0xffff;
        z[zp++] = nlen & 0xff; z[zp++] = (nlen >>> 8) & 0xff;
        z.set(slice, zp); zp += len;
    }
    new DataView(z.buffer).setUint32(zp, ((s2 << 16) | s1) >>> 0);

    const ihdr = new Uint8Array(13);
    const idv = new DataView(ihdr.buffer);
    idv.setUint32(0, dim); idv.setUint32(4, dim);
    ihdr[8] = 1; ihdr[9] = 0; // 1-bit grayscale

    const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const cIhdr = pngChunk("IHDR", ihdr);
    const cIdat = pngChunk("IDAT", z);
    const cIend = pngChunk("IEND", new Uint8Array(0));
    const png = new Uint8Array(sig.length + cIhdr.length + cIdat.length + cIend.length);
    png.set(sig, 0);
    png.set(cIhdr, sig.length);
    png.set(cIdat, sig.length + cIhdr.length);
    png.set(cIend, sig.length + cIhdr.length + cIdat.length);
    return `data:image/png;base64,${toBase64(png)}`;
}

/** 台账行的扫码内容：思源块深链（块 ID 定位） */
export function blockDeepLink(blockId: string): string {
    return `siyuan://blocks/${blockId}`;
}
