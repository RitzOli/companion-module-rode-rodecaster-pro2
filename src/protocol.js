/**
 * Protocole RØDECaster Pro II — issu du reverse-engineering (firmware 1.7.3).
 *
 * ALLER  (host -> console) : HID report id 3, trame de 229 octets
 *     03 22 00 00 00 01 01 01 01 <objId> <nomPropriété ASCII> 00 01 <type> <valeur…>
 * RETOUR (console -> host) : HID report id 4, protocole TEXTE de propriétés nommées.
 *     L'objId est l'octet situé JUSTE AVANT le nom (certaines trames — padActive —
 *     n'ont pas l'en-tête standard, d'où la recherche par nom).
 *
 * ⚠️ Les objId sont EMPIRIQUES, pas documentés par RØDE. Validés sur firmware 1.7.3.
 */

export const FIRMWARE_TESTED = '1.7.3'

/**
 * La version du firmware est portée par le descripteur USB (`bcdDevice`, exposé par
 * hidapi sous `release`) : 0x0173 -> "1.7.3". C'est la source fiable — la console ne
 * diffuse aucune propriété de version dans son flux HID.
 */
export function decodeFirmware(release) {
	if (!release && release !== 0) return null
	return `${(release >> 8) & 0xff}.${(release >> 4) & 0x0f}.${release & 0x0f}`
}

export const VID = 0x19f7
export const HID_INTERFACE = 9
export const HID_USAGE_PAGE = 0xff00

const HDR = Buffer.from('032200000001010101', 'hex') // rid=3, seq, route fixe
const PAD_HDR = Buffer.from([0x03, 0x22, 0x00, 0x00, 0x00, 0x01, 0x01, 0x02, 0x00, 0x01])
// Couleur des pads : en-tête « objet f4 » (route ...01 01 02 01) puis TLV f4 <len> <addr>.
const PAD_COLOUR_ROUTE = Buffer.from([0x03, 0x22, 0x00, 0x00, 0x00, 0x01, 0x01, 0x02, 0x01])
const FRAME_LEN = 229

export const CH_BASE = 0x1a // canal N -> objId CH_BASE + (N-1)
export const PAD_OBJ = [0x23, 0x27, 0x24, 0x28, 0x25, 0x29, 0x26, 0x2a] // déclenchement pads 1..8
export const N_BANKS = 6

/** Sans calibration : objId & 7 -> case physique (colonne G = 1,3,5,7 / D = 2,4,6,8). */
export const PAD_FALLBACK = { 0: 1, 1: 3, 2: 5, 3: 7, 4: 2, 5: 4, 6: 6, 7: 8 }
/** Inverse : case physique (1-8) -> slot. La COULEUR d'un pad est POSITIONNELLE (pas l'objId du son). */
export const PAD_SLOT = { 1: 0, 2: 4, 3: 1, 4: 5, 5: 2, 6: 6, 7: 3, 8: 7 }

/**
 * Palette couleur des pads (padColourIndex) — index 0..15, cartographiée par reverse (firmware 1.7.3).
 * ⚠️ index >= 16 = HORS palette (comportement indéfini côté console) -> ne jamais envoyer.
 */
export const PAD_PALETTE = [
	{ id: 0, label: 'Rouge', hex: '#e23b2e' }, { id: 1, label: 'Orange', hex: '#e8722a' },
	{ id: 2, label: 'Jaune foncé', hex: '#d8a41e' }, { id: 3, label: 'Jaune clair', hex: '#ecd93f' },
	{ id: 4, label: 'Jaune-vert', hex: '#b4d62e' }, { id: 5, label: 'Vert', hex: '#35c04a' },
	{ id: 6, label: 'Turquoise', hex: '#1fc7b6' }, { id: 7, label: 'Bleu', hex: '#2f6fe0' },
	{ id: 8, label: 'Bleu foncé', hex: '#3a45d8' }, { id: 9, label: 'Violet clair', hex: '#8f6ff0' },
	{ id: 10, label: 'Violet', hex: '#a94ee0' }, { id: 11, label: 'Rose', hex: '#e85fbf' },
	{ id: 12, label: 'Rose foncé', hex: '#e0347f' }, { id: 13, label: 'Vert flashy', hex: '#56e03a' },
	{ id: 14, label: 'Bleu ciel', hex: '#35b6f0' }, { id: 15, label: 'Orange pâle', hex: '#f0b060' },
]
export const PAD_COLOUR_MAX = 15

export const SOURCE_NAMES = {
	0x00: 'Mic 1', 0x01: 'Mic 2', 0x02: 'Mic 3', 0x03: 'Mic 4',
	0x04: 'Line 1', 0x06: 'Line 2', 0x07: 'USB 1', 0x08: 'USB Chat',
	0x09: 'USB 2', 0x0a: 'Bluetooth', 0x0b: 'Pad', 0x10: 'Call Me', 0xff: '—',
}

/** MIDI : CC15 sur le canal (N-1) = position ABSOLUE du fader du canal N (0..127). */
export const CC_FADER = 15
export const CC_ENCODER = 43
export const CC_ENC_PUSH = 47

// ---------------------------------------------------------------- construction

function frame(header, obj, name, tail) {
	const body = Buffer.concat([header, Buffer.from([obj]), Buffer.from(name, 'ascii'), Buffer.from(tail)])
	if (body.length > FRAME_LEN) throw new Error('trame trop longue')
	return Buffer.concat([body, Buffer.alloc(FRAME_LEN - body.length)])
}

const boolTail = (on) => [0x00, 0x01, 0x01, on ? 0x02 : 0x03] // 02 = actif, 03 = inactif
const enumTail = (v) => [0x00, 0x01, 0x05, 0x01, v & 0xff]

/**
 * Trame COULEUR d'un pad : `…01 01 02 01 f4 <len> <addr> padColourIndex 00 01 05 01 <int32>`.
 * addr = banque*8 + slot physique (len 0 si addr==0, sinon 1). L'écriture est BANK-INDÉPENDANTE
 * (colore la banque visée sans la sélectionner). colour = index palette 0..15.
 */
function padColourFrame(idx, colour, bank) {
	const slot = PAD_SLOT[((idx - 1) % 8) + 1]
	const addr = ((bank & 0xff) * 8 + slot) & 0xff
	const tlv = addr === 0 ? [0xf4, 0x00] : [0xf4, 0x01, addr]
	const v = Buffer.alloc(4)
	v.writeInt32LE(Math.max(0, Math.min(PAD_COLOUR_MAX, colour | 0)), 0)
	const body = Buffer.concat([
		PAD_COLOUR_ROUTE, Buffer.from(tlv), Buffer.from('padColourIndex', 'ascii'),
		Buffer.from([0x00, 0x01, 0x05, 0x01]), v,
	])
	return Buffer.concat([body, Buffer.alloc(FRAME_LEN - body.length)])
}

export const cmd = {
	/** Mute d'un canal (1-9). on=true -> muté. */
	mute: (ch, on) => frame(HDR, CH_BASE + ch - 1, 'channelOutputMute', boolTail(on)),
	/** PFL / cue d'un canal (1-9). */
	pfl: (ch, on) => frame(HDR, CH_BASE + ch - 1, 'channelCueEnable', boolTail(on)),
	/** Enregistrement : start (02) / stop (00). */
	record: (on) => frame(HDR, 0x02, 'requestRecordState', [0x00, 0x01, 0x05, 0x01, on ? 0x02 : 0x00]),
	/** Sélection de canal — index 0-based. ⚠️ NE JAMAIS envoyer 0xff (reboot console). */
	select: (ch) => frame(HDR, 0x0d, 'systemChannelSelected', enumTail(ch - 1)),
	/** Banque de pads (0-based). Sert AUSSI de « réveil » du flux de retour. */
	bank: (b) => frame(HDR, 0x05, 'selectedBank', enumTail(b)),
	/** Gain d'entrée (dB signé) du canal sélectionné. */
	gain: (db) => {
		const v = Buffer.alloc(4)
		v.writeInt32LE(db | 0, 0)
		return frame(HDR, 0xe9, 'inputDigitalGain', [0x00, 0x01, 0x05, 0x01, ...v])
	},
	/** Appui/relâché d'un pad (position 1-8, en-tête PAD spécifique). */
	padDown: (idx) => frame(PAD_HDR, PAD_OBJ[(idx - 1) % 8], 'padButtonPressed', boolTail(true)),
	padUp: (idx) => frame(PAD_HDR, PAD_OBJ[(idx - 1) % 8], 'padButtonPressed', boolTail(false)),
	/** Couleur d'un pad (position 1-8) d'une banque (0-based) = index palette 0-15. LED en direct. */
	padColour: (idx, colour, bank = 0) => padColourFrame(idx, colour, bank),
	/** Encodeur : push (change de canal) / rotation d'un cran (fader du canal courant). */
	encPushDown: () => frame(HDR, 0x04, 'encoderPressed', boolTail(true)),
	encPushUp: () => frame(HDR, 0x04, 'encoderPressed', boolTail(false)),
	encTurn: (up, phase) =>
		frame(HDR, 0x04, 'encoderSignal', [
			0x00, 0x01, 0x0b, 0x08, 0x01, 0x05, 0x01,
			...(up ? [0x01, 0x00, 0x00, 0x00] : [0xff, 0xff, 0xff, 0xff]),
			0x01, 0x01, phase ? 0x02 : 0x03,
		]),
}

/*
 * ⚠️ Volontairement ABSENT : un constructeur de commande « brute » (objId + nom + octets
 * libres). Écrire une valeur non validée peut avoir des effets destructeurs — pendant le
 * reverse, `systemChannelSelected = 0xff` a fait REDÉMARRER la console. Le module n'expose
 * donc que des commandes vérifiées. Toute nouvelle commande doit être ajoutée ici, testée,
 * puis exposée comme action explicite.
 */

// ---------------------------------------------------------------- analyse

const PROP_RE =
	/(padActive|padColourIndex|selectedBank|channelOutputMute|channelCueEnable|mutePressed|recordState|requestRecordState|channelInputSource|systemChannelSelected)/

/**
 * Décode un report entrant (rid 4).
 * @returns {{obj:number,name:string,tail:Buffer}|null}
 */
export function parseReport(buf) {
	if (!buf || buf.length < 12 || buf[0] !== 4) return null
	const head = buf.subarray(0, 48).toString('latin1')
	const m = PROP_RE.exec(head)
	if (!m) return null
	const start = m.index
	return {
		obj: start > 0 ? buf[start - 1] : 0, // l'objId est l'octet AVANT le nom
		name: m[1],
		tail: buf.subarray(start + m[1].length, start + m[1].length + 8),
	}
}

/** Valeur booléenne d'une propriété (02 = actif). */
export const boolOf = (tail) => tail.length > 3 && tail[3] === 0x02
/** Valeur enum/int d'une propriété. */
export const enumOf = (tail) => (tail.length > 4 ? tail[4] : 0)
