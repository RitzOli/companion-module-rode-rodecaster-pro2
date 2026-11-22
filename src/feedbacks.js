import { combineRgb } from '@companion-module/base'
import { N_BANKS, PAD_PALETTE } from './protocol.js'

const RED = combineRgb(180, 0, 0)
const GREEN = combineRgb(0, 140, 60)
const AMBER = combineRgb(200, 130, 0)
const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)

const CHOICES_CH = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, label: `Canal ${i + 1}` }))
const CHOICES_PAD = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, label: `Pad ${i + 1}` }))
const CHOICES_BANK = Array.from({ length: N_BANKS }, (_, i) => ({ id: i, label: `Banque ${i + 1}` }))
const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return combineRgb((n >> 16) & 255, (n >> 8) & 255, n & 255) }

export function getFeedbacks(self) {
	return {
		channelMute: {
			name: 'Canal muté',
			type: 'boolean',
			description: 'Vrai quand le canal est coupé sur la console.',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [{ type: 'dropdown', id: 'ch', label: 'Canal', default: 1, choices: CHOICES_CH }],
			callback: ({ options }) => !!self.state.mute[Number(options.ch)],
		},

		channelPfl: {
			name: 'PFL / Cue actif',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [{ type: 'dropdown', id: 'ch', label: 'Canal', default: 1, choices: CHOICES_CH }],
			callback: ({ options }) => !!self.state.pfl[Number(options.ch)],
		},

		recording: {
			name: 'Enregistrement en cours',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [],
			callback: () => !!self.state.record,
		},

		bankIs: {
			name: 'Banque de pads active',
			type: 'boolean',
			defaultStyle: { bgcolor: AMBER, color: WHITE },
			options: [{ type: 'dropdown', id: 'bank', label: 'Banque', default: 0, choices: CHOICES_BANK }],
			callback: ({ options }) => self.state.bank === Number(options.bank),
		},

		faderAbove: {
			name: 'Fader au-dessus d\'un seuil',
			type: 'boolean',
			description: 'Position lue en MIDI (0-127). Utile pour un témoin « voie ouverte ».',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				{ type: 'dropdown', id: 'ch', label: 'Canal', default: 1, choices: CHOICES_CH },
				{ type: 'number', id: 'threshold', label: 'Seuil (0-127)', default: 64, min: 0, max: 127 },
			],
			callback: ({ options }) =>
				(self.state.fader[Number(options.ch)] ?? 0) >= Number(options.threshold),
		},

		padColour: {
			name: 'Pad — refléter la couleur (fond)',
			type: 'advanced',
			description:
				'Met le FOND du bouton Companion à la couleur actuelle de la case (miroir de la console). ' +
				'Ne pilote que le background (gris neutre si la couleur de la case est inconnue).',
			options: [
				{ type: 'dropdown', id: 'idx', label: 'Pad', default: 1, choices: CHOICES_PAD },
				{ type: 'dropdown', id: 'bank', label: 'Banque', default: 0, choices: CHOICES_BANK },
			],
			// TOUJOURS renvoyer UNIQUEMENT bgcolor -> Companion ne propose que l'override « Background ».
			callback: ({ options }) => {
				const c = self.state.padColour?.[Number(options.bank)]?.[Number(options.idx)]
				const p = c != null ? PAD_PALETTE[c] : null
				return { bgcolor: p ? hexRgb(p.hex) : combineRgb(28, 28, 32) }
			},
		},

		padBlinking: {
			name: 'Pad — clignote',
			type: 'boolean',
			description: 'Vrai tant qu\'un clignotement est actif sur cette case (piloté par le module).',
			defaultStyle: { bgcolor: WHITE, color: BLACK },
			options: [
				{ type: 'dropdown', id: 'idx', label: 'Pad', default: 1, choices: CHOICES_PAD },
				{ type: 'dropdown', id: 'bank', label: 'Banque', default: 0, choices: CHOICES_BANK },
			],
			callback: ({ options }) => self.isBlinking(Number(options.bank), Number(options.idx)),
		},

		padActive: {
			name: 'Pad — actif (déclenché / joue)',
			type: 'boolean',
			description:
				'Vrai tant que la case est active sur la console (son en cours ou pad maintenu), ' +
				'd\'après le retour « padActive » de la banque affichée. ' +
				'Booléen : utilisable tel quel comme condition de déclencheur (trigger).',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				{ type: 'dropdown', id: 'idx', label: 'Pad', default: 1, choices: CHOICES_PAD },
				{ type: 'dropdown', id: 'bank', label: 'Banque', default: 0, choices: CHOICES_BANK },
			],
			callback: ({ options }) => !!self.state.padActive?.[Number(options.bank)]?.[Number(options.idx)],
		},
	}
}
