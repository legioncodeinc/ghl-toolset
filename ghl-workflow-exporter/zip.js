// Minimal dependency-free ZIP writer (STORE method, no compression).
// Kept deliberately small so the whole extension is auditable in one sitting.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Fixed 1980-01-01 00:00 DOS timestamp so identical content produces an
// identical archive. Byte-for-byte reproducibility keeps git diffs honest.
const DOS_TIME = 0;
const DOS_DATE = 33;

function u8(str) {
  return new TextEncoder().encode(str);
}

/**
 * @param {Array<{name: string, text: string}>} files
 * @returns {Blob}
 */
export function buildZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = u8(file.name);
    const dataBytes = u8(file.text);
    const crc = crc32(dataBytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header signature
    local.setUint16(4, 20, true);         // version needed
    local.setUint16(6, 0x0800, true);     // flag: UTF-8 filenames
    local.setUint16(8, 0, true);          // method: stored
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, dataBytes.length, true);
    local.setUint32(22, dataBytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);         // extra field length

    chunks.push(new Uint8Array(local.buffer), nameBytes, dataBytes);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);   // central directory signature
    dir.setUint16(4, 20, true);           // version made by
    dir.setUint16(6, 20, true);           // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, DOS_TIME, true);
    dir.setUint16(14, DOS_DATE, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, dataBytes.length, true);
    dir.setUint32(24, dataBytes.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);      // relative offset of local header

    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + dataBytes.length;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);     // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
    type: 'application/zip'
  });
}

/**
 * JSON.stringify with recursively sorted keys, so re-exporting an unchanged
 * workflow produces an identical file and git shows no diff.
 */
export function stableJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object' && v.constructor === Object) {
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = sort(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2) + '\n';
}
