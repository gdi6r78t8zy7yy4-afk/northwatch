// Minimal ZIP-läsare (ingen runtime-beroende) för Riksdagens dataset-zips
// (M11: votering-/anförande-/person-json.zip). Läser central directory +
// local file headers och blowar upp deflate-komprimerade poster med
// node:zlib. Stödjer metod 0 (stored) och 8 (deflate); data-descriptor-poster
// (flagg bit 3) hanteras eftersom storlekarna tas från central directory.
// Filnamn dekodas som UTF-8 (riksdagen.s.zipposters namn innehåller ä/ö/å)
// eller latin1 som fallback – namnen används bara som identifierare.
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LH_SIG = 0x04034b50;

// Hittar End of Central Directory (scannar baklänges, kommentar kan vara 64 kB).
function eocdOffset(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function decodeName(buf, start, len, utf8) {
  const b = buf.subarray(start, start + len);
  return utf8 ? b.toString('utf8') : b.toString('latin1');
}

// Returnerar [{ name, data: Buffer }] i archiveordning.
export function unzip(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('zip: indata måste vara Buffer');
  const eo = eocdOffset(buf);
  if (eo < 0) throw new Error('zip: EOCD hittades inte');
  const entries = buf.readUInt16LE(eo + 10);
  let off = buf.readUInt32LE(eo + 16);
  const out = [];
  for (let i = 0; i < entries; i += 1) {
    if (buf.readUInt32LE(off) !== CD_SIG) break; // skadad/archiv avslutat
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = decodeName(buf, off + 46, nameLen, (flags & 0x800) !== 0);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // katalogpost
    // Local header vid localOff – name/extra-störlekar kan skilja sig från CD.
    if (buf.readUInt32LE(localOff) !== LH_SIG) {
      throw new Error(`zip: lokal header saknas för ${name}`);
    }
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`zip: komprimeringsmetod ${method} stöds ej (${name})`);
    out.push({ name, data });
  }
  return out;
}

// Zips där varje post är en JSON-dokument (Riksdagen) → JSON-objekten.
export const unzipJson = buf => unzip(buf).map(p => JSON.parse(p.data.toString('utf8')));
