// Minimal ZIP reader, enough to read back an archive this extension wrote and
// the deflated ones most tools produce. Decompression uses the platform's own
// DecompressionStream, so there is still no third-party code in the bundle.

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

function findEocd(view) {
  // The end-of-central-directory record sits at the tail, after an optional
  // comment of up to 64KB, so scan backwards for its signature.
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Promise<Array<{name: string, text: string}>>}
 */
export async function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error('Not a ZIP file.');

  const total = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = [];

  for (let i = 0; i < total; i++) {
    if (view.getUint32(pointer, true) !== CENTRAL_SIG) break;

    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));

    // The local header repeats the name and extra fields, and its extra field
    // length can differ from the central one, so read it rather than assume.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(dataStart, dataStart + compressedSize);

    if (!name.endsWith('/')) {
      let content;
      if (method === 0) content = raw;
      else if (method === 8) content = await inflateRaw(raw);
      else throw new Error('Unsupported compression in ' + name);
      entries.push({ name, text: decoder.decode(content) });
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
