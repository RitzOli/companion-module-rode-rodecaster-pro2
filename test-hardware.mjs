/**
 * Test matériel hors Companion : vérifie la détection du firmware, le réveil du flux
 * et le décodage des reports sur une vraie console.
 *
 *   node test-hardware.mjs
 *
 * ⚠️ Fermer MegaControleur / l'app RØDE avant : un seul lecteur draine le flux HID.
 */
import HID from 'node-hid'
import { VID, HID_INTERFACE, HID_USAGE_PAGE, FIRMWARE_TESTED, decodeFirmware, cmd, parseReport, boolOf, enumOf, CH_BASE } from './src/protocol.js'

const found = HID.devices().filter(
	(d) => d.vendorId === VID && (d.interface === HID_INTERFACE || d.usagePage === HID_USAGE_PAGE))
const dev = found.find((d) => d.usagePage === HID_USAGE_PAGE) ?? found[0]
if (!dev) {
	console.error('❌ RØDECaster introuvable (branchée ?)')
	process.exit(1)
}

const fw = decodeFirmware(dev.release)
console.log('=== DÉTECTION ===')
console.log(`  firmware : ${fw}  (référence du module : ${FIRMWARE_TESTED})  ${fw === FIRMWARE_TESTED ? '✅ correspond' : '⚠️ DIFFÉRENT'}`)
console.log(`  série    : ${dev.serialNumber}`)
console.log(`  pid      : 0x${dev.productId.toString(16)}   usagePage : 0x${(dev.usagePage ?? 0).toString(16)}`)

const read = new HID.HID(dev.path)
const write = new HID.HID(dev.path)

let n = 0
const seen = new Map()
read.on('data', (buf) => {
	n++
	const p = parseReport(buf)
	if (!p) return
	const ch = p.obj - CH_BASE + 1
	let val
	if (['channelOutputMute', 'channelCueEnable', 'padActive'].includes(p.name)) val = boolOf(p.tail)
	else val = enumOf(p.tail)
	seen.set(p.name, `obj=0x${p.obj.toString(16)} ch=${ch} val=${val}`)
})
read.on('error', (e) => console.error('erreur HID :', e.message))

console.log('\n=== RÉVEIL DU FLUX (sans ça la console ne diffuse rien) ===')
write.write([...cmd.bank(0)])

// La console ne diffuse que sur CHANGEMENT : on provoque un aller-retour de banque
// pour prouver le chemin de lecture même si personne ne touche la console.
setTimeout(() => { console.log('  → bascule banque 2 …'); write.write([...cmd.bank(1)]) }, 600)
setTimeout(() => { console.log('  → retour banque 1 …'); write.write([...cmd.bank(0)]) }, 1600)

console.log('Écoute 6 s — tu peux aussi bouger un fader / appuyer un mute…\n')
setTimeout(() => {
	console.log(`=== RÉSULTAT ===`)
	console.log(`  reports reçus  : ${n}`)
	console.log(`  propriétés décodées : ${seen.size}`)
	for (const [k, v] of seen) console.log(`     ${k.padEnd(24)} ${v}`)
	console.log(n > 0 ? '\n✅ Flux vivant et décodé.' : '\n⚠️ Aucun report (rien touché ? autre logiciel qui draine ?)')
	read.close(); write.close()
	process.exit(0)
}, 6000)
