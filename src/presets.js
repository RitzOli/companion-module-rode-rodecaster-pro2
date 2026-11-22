import { combineRgb } from '@companion-module/base'
import { N_BANKS } from './protocol.js'

const BLACK = combineRgb(0, 0, 0)
const WHITE = combineRgb(255, 255, 255)
const DARK = combineRgb(20, 20, 20)

const btn = (text, size = '14') => ({
	type: 'button',
	style: { text, size, color: WHITE, bgcolor: DARK },
	steps: [],
	feedbacks: [],
})

export function getPresets() {
	const presets = {}

	// --- Mutes par canal, avec retour d'état (rouge quand coupé) ---
	for (let ch = 1; ch <= 9; ch++) {
		const p = btn(`MUTE ${ch}\\n$(rode-rodecaster-pro2:source_${ch})`, '14')
		p.category = '2 · Mutes'
		p.name = `Mute canal ${ch}`
		p.steps = [{ down: [{ actionId: 'mute', options: { ch, mode: 'toggle' } }], up: [] }]
		p.feedbacks = [{ feedbackId: 'channelMute', options: { ch } }]
		presets[`mute_${ch}`] = p
	}

	// --- PFL par canal ---
	for (let ch = 1; ch <= 9; ch++) {
		const p = btn(`PFL ${ch}`)
		p.category = '3 · PFL / Cue'
		p.name = `PFL canal ${ch}`
		p.steps = [{ down: [{ actionId: 'pfl', options: { ch, mode: 'toggle' } }], up: [] }]
		p.feedbacks = [{ feedbackId: 'channelPfl', options: { ch } }]
		presets[`pfl_${ch}`] = p
	}

	// --- Pads (position physique — calibrer la banque d'abord) ---
	for (let i = 1; i <= 8; i++) {
		const p = btn(`PAD\\n${i}`, '18')
		p.category = '4 · Pads — appui bref'
		p.name = `Pad ${i} — appui bref (one-shot / bascule)`
		p.steps = [{ down: [{ actionId: 'pad', options: { idx: i } }], up: [] }]
		presets[`pad_${i}`] = p
	}

	// Variante MAINTIEN : le son joue tant que le bouton Companion est enfoncé.
	// Indispensable pour les pads réglés en mode « hold / gate ».
	for (let i = 1; i <= 8; i++) {
		const p = btn(`PAD ${i}\\nMAINTIEN`, '14')
		p.category = '5 · Pads — maintien'
		p.name = `Pad ${i} — maintien (appui → relâché)`
		p.steps = [{
			down: [{ actionId: 'padPress', options: { idx: i } }],
			up: [{ actionId: 'padRelease', options: { idx: i } }],
		}]
		presets[`pad_hold_${i}`] = p
	}

	// Variante avec TÉMOIN : déclenche le pad ET s'allume (vert) tant qu'il est actif (retour padActive).
	// Le témoin est calé sur la banque 1 — ajuste l'option « Banque » du feedback pour une autre banque.
	for (let i = 1; i <= 8; i++) {
		const p = btn(`PAD\\n${i}`, '18')
		p.category = '6 · Pads — avec témoin'
		p.name = `Pad ${i} — déclencher + témoin actif (banque 1)`
		p.steps = [{ down: [{ actionId: 'pad', options: { idx: i } }], up: [] }]
		p.feedbacks = [{ feedbackId: 'padActive', options: { idx: i, bank: 0 } }]
		presets[`pad_lit_${i}`] = p
	}

	// --- Banques, avec témoin de la banque active ---
	for (let b = 0; b < N_BANKS; b++) {
		const p = btn(`BANQUE\\n${b + 1}`)
		p.category = '7 · Banques de pads'
		p.name = `Banque ${b + 1}`
		p.steps = [{ down: [{ actionId: 'bank', options: { bank: b } }], up: [] }]
		p.feedbacks = [{ feedbackId: 'bankIs', options: { bank: b } }]
		presets[`bank_${b}`] = p
	}

    // --- Transport ---
	const rec = btn('REC', '18')
	rec.category = '8 · Enregistrement'
	rec.name = 'Enregistrement (bascule)'
	rec.steps = [{ down: [{ actionId: 'record', options: { mode: 'toggle' } }], up: [] }]
	rec.feedbacks = [{ feedbackId: 'recording', options: {} }]
	presets.record = rec

	// --- Témoins de faders (voie ouverte) ---
	for (let ch = 1; ch <= 9; ch++) {
		const p = btn(`F${ch}\\n$(rode-rodecaster-pro2:fader_${ch}_pct)%`)
		p.category = '9 · Faders (témoins)'
		p.name = `Fader ${ch} — position + voie ouverte`
		p.feedbacks = [{ feedbackId: 'faderAbove', options: { ch, threshold: 8 } }]
		presets[`fader_${ch}`] = p
	}

	// --- Calibration des pads ---
	const cal = btn('CALIB\\nPADS', '14')
	cal.category = '1 · Calibration des pads'
	cal.name = 'Démarrer la calibration des pads (banque 1)'
	cal.steps = [{ down: [{ actionId: 'padCalStart', options: { bank: 0 } }], up: [] }]
	presets.pad_cal_start = cal

	const calEnd = btn('CALIB\\nTERMINER', '14')
	calEnd.category = '1 · Calibration des pads'
	calEnd.name = 'Terminer la calibration des pads'
	calEnd.steps = [{ down: [{ actionId: 'padCalFinish', options: {} }], up: [] }]
	presets.pad_cal_finish = calEnd

	return presets
}
