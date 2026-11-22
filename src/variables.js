import { SOURCE_NAMES, N_BANKS } from './protocol.js'

export function initVariables(self) {
	const defs = [
		{ variableId: 'bank', name: 'Banque de pads active (1-6)' },
		{ variableId: 'record', name: 'Enregistrement (on/off)' },
		{ variableId: 'selected_channel', name: 'Canal sélectionné sur la console' },
		{ variableId: 'last_pad', name: 'Dernier pad déclenché (ex B1-3)' },
		{ variableId: 'firmware', name: 'Firmware de la console (descripteur USB)' },
		{ variableId: 'serial', name: 'Numéro de série de la console' },
	]
	for (let ch = 1; ch <= 9; ch++) {
		defs.push(
			{ variableId: `fader_${ch}`, name: `Fader ${ch} — position 0-127` },
			{ variableId: `fader_${ch}_pct`, name: `Fader ${ch} — position %` },
			{ variableId: `mute_${ch}`, name: `Canal ${ch} — muté` },
			{ variableId: `pfl_${ch}`, name: `Canal ${ch} — PFL` },
			{ variableId: `source_${ch}`, name: `Canal ${ch} — source assignée` },
		)
	}
	for (let b = 1; b <= N_BANKS; b++) {
		for (let p = 1; p <= 8; p++) {
			defs.push({ variableId: `pad_active_b${b}_p${p}`, name: `Pad actif — Banque ${b} Pad ${p}` })
		}
	}
	defs.push(
		{ variableId: 'midi_last', name: 'Dernier message MIDI reçu (diagnostic)' },
		{ variableId: 'midi_learn', name: 'Apprentissage MIDI — état / dernière case apprise' },
	)
	self.setVariableDefinitions(defs)
	updateVariables(self)
}

export function updateVariables(self) {
	const s = self.state
	const values = {
		bank: s.bank + 1,
		record: s.record ? 'on' : 'off',
		selected_channel: s.selected + 1,
		last_pad: s.lastPad ? `B${s.bank + 1}-${s.lastPad}` : '',
		firmware: s.firmware ?? '',
		serial: s.serial ?? '',
	}
	for (let ch = 1; ch <= 9; ch++) {
		const f = s.fader[ch]
		values[`fader_${ch}`] = f ?? ''
		values[`fader_${ch}_pct`] = f === undefined ? '' : Math.round((f / 127) * 100)
		values[`mute_${ch}`] = s.mute[ch] ? 'on' : 'off'
		values[`pfl_${ch}`] = s.pfl[ch] ? 'on' : 'off'
		values[`source_${ch}`] = SOURCE_NAMES[s.source[ch]] ?? ''
	}
	for (let b = 1; b <= N_BANKS; b++) {
		const bank = s.padActive?.[b - 1] ?? {} // état stocké en banque 0-based
		for (let p = 1; p <= 8; p++) {
			values[`pad_active_b${b}_p${p}`] = bank[p] ? 'on' : 'off'
		}
	}
	values.midi_last = s.midiLast ?? ''

	// N'envoie QUE ce qui a changé. Sans ce filtre, un simple mouvement de fader réécrivait
	// la centaine de variables à chaque message MIDI — Companion réévalue les déclencheurs à
	// chaque écriture, d'où des triggers qui traînent.
	const prev = (self._lastVars ??= {})
	const delta = {}
	let n = 0
	for (const k in values) {
		if (prev[k] !== values[k]) { delta[k] = values[k]; prev[k] = values[k]; n++ }
	}
	if (n) self.setVariableValues(delta)
}
