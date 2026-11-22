/**
 * Test MIDI hors Companion : ouverture du port RØDECaster + lecture des faders (CC15).
 *   node test-midi.mjs
 * ⚠️ Fermer MegaControleur / l'app RØDE : le port MIDI est EXCLUSIF.
 */
import { CC_FADER, CC_ENCODER, CC_ENC_PUSH } from './src/protocol.js'

const mod = await import('@julusian/midi')
const { Input } = mod.default ?? mod
const input = new Input()

const names = []
for (let i = 0; i < input.getPortCount(); i++) names.push(input.getPortName(i))
console.log('=== PORTS MIDI D\'ENTRÉE ===')
names.forEach((n, i) => console.log(`  [${i}] ${n}`))

const idx = names.findIndex((n) => n.toLowerCase().includes('midi function'))
if (idx < 0) {
	console.error('\n❌ Port « MIDI function » introuvable — console branchée ? port pris par un autre logiciel ?')
	process.exit(1)
}
console.log(`\n✅ Ouverture de « ${names[idx]} »`)

const faders = new Map()
let other = 0
input.on('message', (_d, [status, cc, val]) => {
	if ((status & 0xf0) !== 0xb0) return
	const chan = status & 0x0f
	if (cc === CC_FADER) faders.set(chan + 1, val)
	else if (cc === CC_ENCODER || cc === CC_ENC_PUSH) other++
})
input.openPort(idx)

console.log('\n⏳ 12 s — BOUGE LE FADER 1 (puis d\'autres si tu veux)…\n')
setTimeout(() => {
	console.log('=== RÉSULTAT ===')
	if (faders.size) {
		for (const [ch, v] of [...faders].sort((a, b) => a[0] - b[0])) {
			console.log(`  fader ${ch} : ${v}/127  (${Math.round((v / 127) * 100)} %)`)
		}
		console.log('\n✅ Les faders remontent — le seuil fonctionnera.')
	} else {
		console.log('  aucun CC15 reçu')
		console.log(other ? '  (mais encodeur vu -> port OK, aucun fader bougé)'
			: '\n⚠️ Rien reçu : soit aucun fader bougé, soit le port est pris par un autre logiciel.')
	}
	input.closePort()
	process.exit(0)
}, 12000)
