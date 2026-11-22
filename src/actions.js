import { cmd, N_BANKS, PAD_PALETTE } from './protocol.js'

const CHOICES_CH = Array.from({ length: 9 }, (_, i) => ({ id: i + 1, label: `Canal ${i + 1}` }))
const CHOICES_PAD = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, label: `Pad ${i + 1}` }))
const CHOICES_BANK = Array.from({ length: N_BANKS }, (_, i) => ({ id: i, label: `Banque ${i + 1}` }))
const CHOICES_COLOUR = PAD_PALETTE.map((c) => ({ id: c.id, label: `${c.id} · ${c.label}` }))
const BLINK_MODE = [
	{ id: 'start', label: 'Démarrer' },
	{ id: 'stop', label: 'Arrêter' },
	{ id: 'toggle', label: 'Basculer' },
]
const ONOFF = [
	{ id: 'on', label: 'Activer' },
	{ id: 'off', label: 'Désactiver' },
	{ id: 'toggle', label: 'Basculer' },
]

const resolve = (mode, current) => (mode === 'toggle' ? !current : mode === 'on')

export function getActions(self) {
	return {
		mute: {
			name: 'Mute — canal',
			options: [
				{ type: 'dropdown', id: 'ch', label: 'Canal', default: 1, choices: CHOICES_CH },
				{ type: 'dropdown', id: 'mode', label: 'Action', default: 'toggle', choices: ONOFF },
			],
			callback: async ({ options }) => {
				const on = resolve(options.mode, self.state.mute[options.ch])
				self.send(cmd.mute(Number(options.ch), on), 'mute')
			},
		},

		pfl: {
			name: 'PFL / Cue — canal',
			options: [
				{ type: 'dropdown', id: 'ch', label: 'Canal', default: 1, choices: CHOICES_CH },
				{ type: 'dropdown', id: 'mode', label: 'Action', default: 'toggle', choices: ONOFF },
			],
			callback: async ({ options }) => {
				const on = resolve(options.mode, self.state.pfl[options.ch])
				self.send(cmd.pfl(Number(options.ch), on), 'pfl')
			},
		},

		record: {
			name: 'Enregistrement',
			options: [{ type: 'dropdown', id: 'mode', label: 'Action', default: 'toggle', choices: ONOFF }],
			callback: async ({ options }) => {
				const on = resolve(options.mode, self.state.record)
				self.send(cmd.record(on), 'record')
			},
		},

		pad: {
			name: 'Pad — déclencher (appui bref)',
			description:
				'Joue le pad de la banque affichée sur la console. ' +
				'Appui + relâché immédiat. Convient aux pads « one-shot » et « bascule » ' +
				'(sur un pad bascule, un 2ᵉ appui arrête le son). Pour un pad en mode MAINTIEN, ' +
				'utilise plutôt « appuyer » sur l\'appui du bouton et « relâcher » sur le relâché.',
			options: [{ type: 'dropdown', id: 'idx', label: 'Pad', default: 1, choices: CHOICES_PAD }],
			callback: async ({ options }) => {
				const i = Number(options.idx)
				self.send(cmd.padDown(i), 'pad')
				setTimeout(() => self.send(cmd.padUp(i), 'pad'), 25)
			},
		},

		padPress: {
			name: 'Pad — appuyer (maintenir)',
			description: 'Envoie uniquement l\'APPUI. À poser sur l\'action « appui » du bouton Companion.',
			options: [{ type: 'dropdown', id: 'idx', label: 'Pad', default: 1, choices: CHOICES_PAD }],
			callback: async ({ options }) => self.send(cmd.padDown(Number(options.idx)), 'padPress'),
		},

		padRelease: {
			name: 'Pad — relâcher / arrêter',
			description: 'Envoie uniquement le RELÂCHÉ. À poser sur l\'action « relâché » du bouton Companion.',
			options: [{ type: 'dropdown', id: 'idx', label: 'Pad', default: 1, choices: CHOICES_PAD }],
			callback: async ({ options }) => self.send(cmd.padUp(Number(options.idx)), 'padRelease'),
		},

		padColour: {
			name: 'Pad — couleur',
			description:
				'Change la couleur d\'une case (banque au choix). La LED change en direct, ' +
				'sans avoir à sélectionner la banque sur la console.',
			options: [
				{ type: 'dropdown', id: 'idx', label: 'Pad', default: 1, choices: CHOICES_PAD },
				{ type: 'dropdown', id: 'bank', label: 'Banque', default: 0, choices: CHOICES_BANK },
				{ type: 'dropdown', id: 'colour', label: 'Couleur', default: 0, choices: CHOICES_COLOUR },
			],
			callback: async ({ options }) =>
				self.setPadColour(Number(options.bank), Number(options.idx), Number(options.colour)),
		},

		padBlink: {
			name: 'Pad — clignoter',
			description:
				'Fait clignoter une case en continu (couleur choisie ⟷ sa couleur actuelle). ' +
				'« Basculer » démarre/arrête, « Arrêter » stoppe et remet la couleur d\'avant. ' +
				'Si le module ne connaît pas encore la couleur de la case, règle-la d\'abord avec « Pad — couleur », ' +
				'sinon le clignotement ne se voit pas.',
			options: [
				{ type: 'dropdown', id: 'idx', label: 'Pad', default: 1, choices: CHOICES_PAD },
				{ type: 'dropdown', id: 'bank', label: 'Banque', default: 0, choices: CHOICES_BANK },
				{ type: 'dropdown', id: 'colour', label: 'Couleur du clignotement', default: 0, choices: CHOICES_COLOUR },
				{ type: 'dropdown', id: 'mode', label: 'Action', default: 'toggle', choices: BLINK_MODE },
				{ type: 'number', id: 'period', label: 'Période (ms)', default: 500, min: 120, max: 5000 },
			],
			callback: async ({ options }) => {
				const bank = Number(options.bank), pad = Number(options.idx)
				if (options.mode === 'stop') self.stopBlink(bank, pad)
				else if (options.mode === 'toggle' && self.isBlinking(bank, pad)) self.stopBlink(bank, pad)
				else self.startBlink(bank, pad, Number(options.colour), Number(options.period))
			},
		},

		padBlinkStopAll: {
			name: 'Pad — arrêter tous les clignotements',
			options: [],
			callback: async () => self.stopAllBlinks(),
		},

		bank: {
			name: 'Banque de pads',
			options: [{ type: 'dropdown', id: 'bank', label: 'Banque', default: 0, choices: CHOICES_BANK }],
			callback: async ({ options }) => self.send(cmd.bank(Number(options.bank)), 'bank'),
		},

		select: {
			name: 'Sélectionner un canal',
			description: 'Ouvre la page du canal sur la console.',
			options: [{ type: 'dropdown', id: 'ch', label: 'Canal', default: 1, choices: CHOICES_CH }],
			callback: async ({ options }) => self.send(cmd.select(Number(options.ch)), 'select'),
		},

		gain: {
			name: 'Gain d\'entrée (canal sélectionné)',
			options: [{ type: 'number', id: 'db', label: 'dB', default: 0, min: -60, max: 24 }],
			callback: async ({ options }) => self.send(cmd.gain(Number(options.db)), 'gain'),
		},

		encoderPush: {
			name: 'Encodeur — appui (canal suivant)',
			options: [],
			callback: async () => {
				self.send(cmd.encPushDown(), 'encPush')
				setTimeout(() => self.send(cmd.encPushUp(), 'encPush'), 20)
			},
		},

		encoderTurn: {
			name: 'Encodeur — rotation (fader du canal courant)',
			description: 'Relatif : chaque cran bouge le fader du canal actuellement pointé.',
			options: [
				{ type: 'number', id: 'ticks', label: 'Crans (négatif = baisser)', default: 5, min: -110, max: 110 },
			],
			callback: async ({ options }) => {
				const n = Number(options.ticks)
				const up = n > 0
				for (let i = 0; i < Math.abs(n); i++) {
					self.send(cmd.encTurn(up, true), 'encTurn')
					self.send(cmd.encTurn(up, false), 'encTurn')
				}
			},
		},

		padCalStart: {
			name: 'Pads — démarrer la calibration',
			description:
				'Sert au témoin « Pad — actif » : la console désigne les pads selon l\'ordre d\'affectation audio, ' +
				'pas leur position physique. Lance ceci puis appuie sur tes pads dans l\'ordre physique voulu.',
			options: [{ type: 'dropdown', id: 'bank', label: 'Banque', default: 0, choices: CHOICES_BANK }],
			callback: async ({ options }) => self.startPadCal(Number(options.bank)),
		},

		padCalFinish: {
			name: 'Pads — terminer la calibration',
			description: 'Enregistre les pads capturés (utile si des pads vides n\'émettent rien).',
			options: [],
			callback: async () => self.finishPadCal(),
		},
	}
}
