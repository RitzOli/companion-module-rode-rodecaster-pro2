/**
 * Test matériel de la COULEUR des pads (hors Companion).
 *   node test-colour.mjs
 * Envoie des couleurs sur plusieurs pads/banques via cmd.padColour, puis un mini-clignotement.
 * ⚠️ Fermer l'app RØDE / MegaControleur avant (un seul écrivain à la fois de préférence).
 */
import HID from 'node-hid'
import { VID, HID_INTERFACE, HID_USAGE_PAGE, cmd, PAD_PALETTE } from './src/protocol.js'

const found = HID.devices().filter(
	(d) => d.vendorId === VID && (d.interface === HID_INTERFACE || d.usagePage === HID_USAGE_PAGE))
const dev = found.find((d) => d.usagePage === HID_USAGE_PAGE) ?? found[0]
if (!dev) { console.error('❌ RØDECaster introuvable'); process.exit(1) }
const write = new HID.HID(dev.path)
const send = (buf, label) => { write.write([...buf]); console.log('  →', label) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('=== SET couleurs (banque 1 = index 0) ===')
send(cmd.padColour(1, 5, 0), 'B1 P1 -> 5 (vert)')
send(cmd.padColour(3, 10, 0), 'B1 P3 -> 10 (violet)')
send(cmd.padColour(8, 14, 0), 'B1 P8 -> 14 (bleu ciel)')
console.log('=== SET banque 2 (index 1) SANS y basculer (bank-indépendant) ===')
send(cmd.padColour(2, 1, 1), 'B2 P2 -> 1 (orange)')

console.log('=== mini-clignotement B1 P5 : 0 <-> 7 x4 ===')
await sleep(400)
for (let i = 0; i < 4; i++) {
	send(cmd.padColour(5, 0, 0), 'B1 P5 -> 0')
	await sleep(300)
	send(cmd.padColour(5, 7, 0), 'B1 P5 -> 7')
	await sleep(300)
}
send(cmd.padColour(5, 5, 0), 'B1 P5 -> 5 (restaure vert)')

console.log(`\npalette : ${PAD_PALETTE.map((c) => c.id + '=' + c.label).join(', ')}`)
console.log('✅ terminé')
write.close()
process.exit(0)
