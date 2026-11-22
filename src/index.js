import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import HID from 'node-hid'
import {
	FIRMWARE_TESTED, VID, HID_INTERFACE, HID_USAGE_PAGE,
	CH_BASE, N_BANKS, PAD_FALLBACK, SOURCE_NAMES,
	CC_FADER, CC_ENCODER, CC_ENC_PUSH,
	cmd, parseReport, boolOf, enumOf, decodeFirmware,
} from './protocol.js'
import { getActions } from './actions.js'
import { getFeedbacks } from './feedbacks.js'
import { initVariables, updateVariables } from './variables.js'
import { getPresets } from './presets.js'

/** Le port MIDI est exclusif : s'il est pris, on retente jusqu'à ce que l'autre logiciel le lâche. */
const MIDI_RETRY_MS = 10000
/** Vérification périodique que la console est toujours énumérée (débranchement souvent SILENCIEUX). */
const HID_WATCH_MS = 5000

class RCP2Instance extends InstanceBase {
	async init(config) {
		this.config = config ?? {}
		this.#parseMidiMap() // correspondance note MIDI -> (banque, case), lue dans la config
		this.state = {
			mute: {}, pfl: {}, fader: {}, source: {},
			bank: 0, record: false, selected: 0,
			padCal: this.#loadPadCal(),
			padColour: {},            // { banque: { case1-8: index palette } } — couleurs posées (source de vérité côté module)
			padActive: {},            // { banque: { case1-8: bool } } — pad actif : HID (audio) ou note MIDI mappée (latch)
			padSeq: null, padSeqBank: 0,
			midiLast: '',             // diagnostic : dernier message MIDI reçu
			firmware: null, serial: '',
		}
		this.blinks = new Map()      // "banque:case" -> intervalId (clignotements en cours, indépendants)

		this.setActionDefinitions(getActions(this))
		this.setFeedbackDefinitions(getFeedbacks(this))
		this.setPresetDefinitions(getPresets(this))
		initVariables(this)

		this.#connect() // le firmware réel est lu au branchement (descripteur USB)
	}

	async configUpdated(config) {
		// Réglages qui touchent la liaison : s'ils n'ont pas bougé, armer un apprentissage ne doit pas la couper.
		const liaison = (c) => JSON.stringify([c?.strictFirmware !== false, c?.useMidi !== false, c?.midiPort || 'MIDI function', c?.wake !== false])
		const memeLiaison = liaison(this.config) === liaison(config)
		this.config = config
		this.#parseMidiMap()
		const arme = this.#applyLearnSelection()
		if (arme && memeLiaison && this.hidOk) return // apprentissage armé : on GARDE la connexion ouverte (pas de reconnect)
		this.#disconnect()
		this.#connect()
	}

	async destroy() {
		this.stopAllBlinks()
		clearTimeout(this._retry) // sinon une reconnexion HID en attente relance tout après la destruction
		this.#disconnect()
	}

	getConfigFields() {
		return [
			{
				type: 'static-text', id: 'info', width: 12, label: 'À lire',
				value:
					`Connexion <b>USB</b> : Companion doit tourner sur la machine où le RØDECaster est branché.<br>` +
					`Développé et validé sur le <b>firmware ${FIRMWARE_TESTED}</b>. Le protocole n'est pas publié par RØDE : ` +
					`les identifiants sont issus d'un reverse-engineering et peuvent changer avec une mise à jour.<br>` +
					`⚠️ Un seul logiciel à la fois peut tenir le port MIDI de la console.`,
			},
			{
				type: 'checkbox', id: 'wake', label: 'Réveiller le flux', width: 6,
				default: true,
				tooltip:
					'La console ne diffuse AUCUN état tant qu\'elle n\'a pas reçu une commande. ' +
					'Sans ce réveil, aucun retour (mute, pads, banque) n\'arrive. Laisse coché. ' +
					'Au démarrage de Companion, le réveil remet la console sur la banque 1.',
			},
			{
				type: 'checkbox', id: 'strictFirmware', label: 'Refuser un autre firmware', width: 6,
				default: true,
				tooltip:
					`Le firmware est lu automatiquement dans le descripteur USB. Coché, le module refuse ` +
					`de se connecter si ce n'est pas le ${FIRMWARE_TESTED}. Décoché, il se connecte quand même, ` +
					`à tes risques : des commandes peuvent rester sans effet.`,
			},
			{
				type: 'checkbox', id: 'useMidi', label: 'Lire les faders (MIDI)', width: 6,
				default: true,
				tooltip:
					'CC15 par canal = position absolue. Décoche si un autre logiciel utilise le port MIDI : ' +
					'tu perds alors la position des faders et le suivi des pads en mode MIDI.',
			},
			{
				type: 'textinput', id: 'midiPort', label: 'Port MIDI de la console', width: 6,
				default: 'MIDI function',
				tooltip: 'Une partie du nom du port suffit. À changer seulement si Windows le nomme autrement.',
			},
			{
				type: 'static-text', id: 'midiMapInfo', width: 12, label: 'Pads en mode MIDI (latch)',
				value:
					'Un pad réglé en MIDI envoie une touche propre à chaque case — Note <b>ou</b> CC, selon le réglage de la console.<br>' +
					'<b>Apprendre une case</b> : choisis-la dans « Apprendre ce pad » ci-dessous, clique <b>Save</b>, ' +
					'puis appuie sur le pad physique — sa touche s\'enregistre toute seule dans « Correspondance touche ↔ pad ».<br>' +
					'Le feedback « Pad — actif » et les variables pad_active_bX_pY suivent alors ce pad.',
			},
			{
				type: 'dropdown', id: 'learnPad', label: 'Apprendre ce pad', width: 12,
				default: '',
				choices: [
					{ id: '', label: '— (aucun apprentissage)' },
					...Array.from({ length: N_BANKS }, (_, b) =>
						Array.from({ length: 8 }, (_, p) => ({ id: `B${b + 1}P${p + 1}`, label: `Banque ${b + 1} · Pad ${p + 1}` })),
					).flat(),
				],
			},
			{
				type: 'textinput', id: 'midiMap', label: 'Correspondance touche ↔ pad', width: 12,
				default: '',
				tooltip: 'Rempli automatiquement. Ex : « B4P8=c1.31, B1P1=n16.36 » (c = CC, n = note ; canal.numéro).',
			},
			{
				type: 'checkbox', id: 'midiLog', label: 'Journal du MIDI reçu', width: 6,
				default: false,
				tooltip:
					'Écrit chaque message MIDI reçu dans le journal. Sert à repérer ce qu\'un pad en ' +
					'mode MIDI/latch envoie (type, note/CC, canal) pour ensuite en suivre l\'état. ' +
					'À désactiver après le diagnostic (bouger un fader génère beaucoup de messages).',
			},
		]
	}

	// ------------------------------------------------------------- connexion
	#connect() {
		clearTimeout(this._retry) // une tentative démarre : annule une reconnexion déjà programmée (sinon double ouverture)
		this._retry = undefined
		this.updateStatus(InstanceStatus.Connecting)
		let dev
		try {
			// ⚠️ PLUSIEURS interfaces RØDE exposent usagePage 0xff00 (vu : « RØDECaster Pro II » en
			// interface 3, à côté de la vraie « HID Interface » en 9). Choisir sur le seul usagePage
			// dépendait donc de l'ordre d'énumération USB — qu'un simple redémarrage suffit à inverser :
			// on ouvrait la mauvaise interface, le HID restait MUET alors que tout semblait connecté.
			// L'interface 9 est la référence du reverse -> on la priorise, l'usagePage n'est qu'un repli.
			const rode = HID.devices().filter((d) => d.vendorId === VID)
			dev = rode.find((d) => d.interface === HID_INTERFACE && d.usagePage === HID_USAGE_PAGE)
				?? rode.find((d) => d.interface === HID_INTERFACE)
				?? rode.find((d) => d.usagePage === HID_USAGE_PAGE)
		} catch (e) {
			return this.#fail(`Énumération HID impossible : ${e.message}`)
		}
		if (!dev) return this.#fail('RØDECaster Pro II introuvable (branché ? interface 9 / usage 0xff00)')
		const path = dev.path

		// Version du firmware : lue dans le descripteur USB (bcdDevice), source fiable.
		const fw = decodeFirmware(dev.release)
		this.state.firmware = fw
		this.state.serial = dev.serialNumber ?? ''
		if (fw && fw !== FIRMWARE_TESTED) {
			const msg =
				`Firmware détecté ${fw} — ce module a été validé sur ${FIRMWARE_TESTED}. ` +
				`Les identifiants d'objets sont empiriques : en cas de commande sans effet, c'est la première piste.`
			if (this.config.strictFirmware !== false) {
				return this.#fail(
					`Connexion refusée : firmware ${fw}, module validé sur le ${FIRMWARE_TESTED}. ` +
					`Pour l'accepter quand même, décoche « Refuser un autre firmware ».`)
			}
			this.log('warn', msg)
		} else if (fw) {
			this.log('info', `Firmware ${fw} — version de référence du module.`)
		}

		try {
			this.hidRead = new HID.HID(path)   // lecture (drainée en continu)
			this.hidWrite = new HID.HID(path)  // écriture séparée : évite de perdre des reports
		} catch (e) {
			return this.#fail(`Ouverture HID refusée : ${e.message} (un autre logiciel la tient ?)`)
		}

		this.hidRead.on('data', (buf) => this.#onReport(buf))
		this.hidRead.on('error', (e) => this.#fail(`HID interrompu : ${e.message}`))

		// ⭐ Réveil : sans commande initiale la console ne diffuse rien du tout.
		if (this.config.wake !== false) {
			try {
				this.hidWrite.write([...cmd.bank(this.state.bank)])
			} catch (e) {
				this.log('warn', `Réveil du flux échoué : ${e.message}`)
			}
		}
		this.hidOk = true
		this.hidPath = path
		this._failing = false // connexion rétablie : réarme la détection de panne
		clearInterval(this._hidWatch) // surveille le débranchement : node-hid ne le signale pas toujours
		this._hidWatch = setInterval(() => this.#checkHidAlive(), HID_WATCH_MS)

		if (this.config.useMidi !== false) void this.#openMidi()

		this.#refreshStatus()
		// L'interface retenue est journalisée : c'est LE point à vérifier si le HID reste muet.
		this.log('info',
			`Connecté — interface ${dev.interface} (PID 0x${dev.productId.toString(16).padStart(4, '0')}, ` +
			`« ${dev.product ?? '?'} »), firmware de référence ${FIRMWARE_TESTED}`)
	}

	#disconnect() {
		this.hidOk = false
		this.hidPath = undefined
		clearInterval(this._hidWatch)
		this._hidWatch = undefined
		clearTimeout(this._midiRetry)
		this._midiRetry = undefined
		for (const h of [this.hidRead, this.hidWrite]) { try { h?.close() } catch { /* ignore */ } }
		this.hidRead = this.hidWrite = undefined
		try { this.midiIn?.closePort() } catch { /* ignore */ }
		this.midiIn = undefined
	}

	/**
	 * Chien de garde HID. node-hid n'émet PAS toujours 'error' quand l'USB est débranché : le flux
	 * devient simplement muet. Sans ce contrôle, `hidOk` resterait vrai et la reprise du MIDI
	 * repasserait le statut au VERT en masquant un HID mort (exactement le cas vécu).
	 * Vérification en LECTURE SEULE : on n'envoie rien à la console.
	 */
	async #checkHidAlive() {
		if (!this.hidOk || !this.hidPath || this._hidChecking) return
		this._hidChecking = true
		try {
			// devicesAsync : la version SYNCHRONE gèle la boucle ~30 ms, ce qui se voit sur les déclencheurs.
			const list = await HID.devicesAsync()
			if (!this.hidOk || !this.hidPath) return // déconnecté pendant l'énumération
			if (!list.some((d) => d.path === this.hidPath)) {
				this.#fail('Console débranchée ou perdue (périphérique HID disparu)')
			}
		} catch {
			// énumération momentanément indisponible : on ne conclut rien
		} finally {
			this._hidChecking = false
		}
	}

	/**
	 * Statut de l'instance. Le MIDI n'est PAS accessoire : sans lui, pas de position de fader
	 * ni de pads en mode MIDI -> on l'affiche en jaune (dégradé) plutôt que de laisser un vert menteur.
	 */
	#refreshStatus() {
		if (!this.hidOk) return
		if (this.config.useMidi === false || this.midiIn) {
			this.updateStatus(InstanceStatus.Ok)
		} else {
			this.updateStatus(InstanceStatus.UnknownWarning, `MIDI indisponible — ${this.midiWhy || 'port non ouvert'}`)
		}
	}

	#fail(msg) {
		if (this._failing) return // fermer un handle peut relancer 'error' -> évite la cascade
		this._failing = true
		this.updateStatus(InstanceStatus.ConnectionFailure, msg)
		this.log('error', msg)
		this.#disconnect() // ⭐ libère les handles morts ET remet hidOk à faux : plus de vert menteur
		clearTimeout(this._retry)
		this._retry = setTimeout(() => {
			this._failing = false // AVANT #connect : sinon un échec suivant serait avalé et la boucle s'arrêterait
			this.#connect()
		}, 4000) // reconnexion à chaud
	}

	/** Envoie une trame ; regroupe la gestion d'erreur. */
	send(buffer, label = '') {
		if (!this.hidWrite) return
		try {
			this.hidWrite.write([...buffer])
		} catch (e) {
			this.log('error', `Envoi échoué ${label} : ${e.message}`)
		}
	}

	// ------------------------------------------------------------- MIDI faders
	async #openMidi() {
		let input
		try {
			// @julusian/midi est en CommonJS : en ESM il faut un import() dynamique
			// (`require` n'existe pas ici — c'était la cause du MIDI muet).
			const mod = await import('@julusian/midi')
			const { Input } = mod.default ?? mod
			const label = this.config.midiPort || 'MIDI function'
			const want = label.toLowerCase()
			// Énumération STATIQUE : pas d'instance créée tant que le port n'existe pas (sinon fuite à chaque essai).
			const names = Input.getPortNames()
			const hits = names.map((n, i) => ({ n, i })).filter((p) => p.n.toLowerCase().includes(want))

			// Cas 1 — Windows ne publie aucun port de ce nom.
			if (!hits.length) {
				return this.#midiUnavailable(
					`port « ${label} » absent de Windows`,
					`Ports vus : ${names.join(' | ') || 'aucun'}. La console doit être re-détectée ` +
					`(débrancher/rebrancher l'USB, ou désactiver/réactiver le périphérique).`)
			}

			// Windows laisse traîner des entrées FANTÔMES du même nom (branchements précédents sur
			// d'autres prises USB) : elles s'énumèrent mais refusent de s'ouvrir, et masquent la vraie.
			// -> on essaie CHAQUE correspondance, pas seulement la première.
			let lastErr
			for (const hit of hits) {
				const cand = new Input()
				try {
					cand.on('message', (_d, msg) => this.#onMidi(msg))
					cand.on('error', (e) => {   // port perdu en cours de route (débranchement, app qui le saisit)
						try { cand.closePort() } catch { /* ignore */ }
						this.#midiUnavailable(`port perdu (${e?.message ?? e})`)
					})
					cand.openPort(hit.i)        // lève si fantôme, ou si un autre logiciel tient le port
				} catch (e) {
					lastErr = e
					try { cand.destroy() } catch { /* ignore */ }
					continue                    // entrée morte : on tente la suivante
				}
				this.midiIn = cand
				this.midiWhy = ''
				this.midiWarned = ''
				clearTimeout(this._midiRetry)
				this._midiRetry = undefined
				this.#refreshStatus()
				return this.log('info', `MIDI ouvert sur « ${hit.n} » — position des faders active.`)
			}

			// Cas 2 — toutes les correspondances ont refusé.
			this.#midiUnavailable(
				`« ${label} » présent mais impossible à ouvrir (${lastErr?.message ?? 'refus'})`,
				`${hits.length} entrée(s) de ce nom, toutes refusées. Deux causes : (a) le port est une ` +
				`ENTRÉE FANTÔME laissée par Windows et la console doit être re-détectée — débrancher/` +
				`rebrancher l'USB ; (b) un autre logiciel le tient (le MIDI Windows est exclusif).`)
		} catch (e) {
			try { input?.destroy() } catch { /* ignore */ }
			this.#midiUnavailable(`erreur MIDI (${e.message})`)
		}
	}

	/**
	 * MIDI indisponible : on le SIGNALE (statut jaune, pas un vert menteur) et on RÉESSAIE
	 * en boucle — dès qu'une autre application libère le port, il est repris tout seul.
	 * Le log n'est écrit qu'au CHANGEMENT de motif (sinon il se remplirait toutes les 10 s).
	 */
	#midiUnavailable(why, hint = '') {
		this.midiIn = undefined
		this.midiWhy = why
		this.#refreshStatus()
		if (this.midiWarned !== why) {
			this.midiWarned = why
			this.log('warn',
				`MIDI indisponible : ${why} — position des faders et pads MIDI hors service. ${hint} ` +
				`Nouvelle tentative toutes les ${MIDI_RETRY_MS / 1000} s.`)
		}
		clearTimeout(this._midiRetry)
		this._midiRetry = setTimeout(() => {
			if (this.hidOk && this.config.useMidi !== false && !this.midiIn) void this.#openMidi()
		}, MIDI_RETRY_MS)
	}

	#onMidi(msg) {
		const [status, d1, d2] = msg
		if (this.config.midiLog) this.#logMidi(msg)
		this.state.midiLast = this.#midiText(msg)              // toujours visible : dernier MIDI reçu
		this.setVariableValues({ midi_last: this.state.midiLast })

		const type = status & 0xf0
		// Faders (CC15) et encodeur : gérés à part, toujours en premier.
		if (type === 0xb0 && d1 === CC_FADER) {
			this.state.fader[(status & 0x0f) + 1] = d2 // canal N -> canal MIDI N-1
			updateVariables(this)
			this.checkFeedbacks('faderAbove')
			return
		}
		if (type === 0xb0 && (d1 === CC_ENCODER || d1 === CC_ENC_PUSH)) return

		// Pads réglés en MIDI : Note OU Control Change. Signature = identité, valeur = on/off.
		const sig = this.#midiSig(msg)
		if (!sig) return
		const on = this.#midiOn(msg)
		if (this.midiLearn && on) return this.#learnSig(sig)   // apprentissage : on retient CETTE touche
		const map = this.midiMap?.[sig]                        // signature -> { bank, pad }
		if (!map) return
		const active = (this.state.padActive[map.bank] ??= {})
		active[map.pad] = on
		this.checkFeedbacks('padActive')
		updateVariables(this)
	}

	/** Texte lisible d'un message MIDI (ex. « NoteOn ch16 43 127 »). */
	#midiText(msg) {
		const status = msg[0] ?? 0
		const NAMES = { 0x80: 'NoteOff', 0x90: 'NoteOn', 0xa0: 'PolyAT', 0xb0: 'CC', 0xc0: 'Program', 0xd0: 'ChanAT', 0xe0: 'PitchBend' }
		const name = NAMES[status & 0xf0] ?? `0x${status.toString(16)}`
		return `${name} ch${(status & 0x0f) + 1} ${msg.slice(1).join(' ')}`.trim()
	}

	/** Diagnostic : journalise un message MIDI brut (pour identifier les pads MIDI/latch). */
	#logMidi(msg) {
		const hex = [...msg].map((b) => b.toString(16).padStart(2, '0')).join(' ')
		this.log('info', `MIDI reçu — ${this.#midiText(msg)}  [${hex}]`)
	}

	/** Signature d'un pad — Note OU CC — indépendante de l'état on/off (ex. « c1.31 », « n16.43 »). */
	#midiSig(msg) {
		const type = msg[0] & 0xf0, ch = (msg[0] & 0x0f) + 1
		if (type === 0x90 || type === 0x80) return `n${ch}.${msg[1]}` // note (on/off = même identité)
		if (type === 0xb0) return `c${ch}.${msg[1]}`                   // control change
		return null
	}

	/** État « actif » d'un pad : NoteOn vélocité > 0, ou CC valeur >= 64. */
	#midiOn(msg) {
		const type = msg[0] & 0xf0
		if (type === 0x90) return (msg[2] ?? 0) > 0
		if (type === 0x80) return false
		if (type === 0xb0) return (msg[2] ?? 0) >= 64
		return false
	}

	// ------------------------------------------------------------- retour HID
	#onReport(buf) {
		const p = parseReport(buf)
		if (!p) return
		const ch = p.obj - CH_BASE + 1
		let dirty = true

		switch (p.name) {
			case 'channelOutputMute':
				this.state.mute[ch] = boolOf(p.tail)
				this.checkFeedbacks('channelMute')
				break
			case 'channelCueEnable':
				this.state.pfl[ch] = boolOf(p.tail)
				this.checkFeedbacks('channelPfl')
				break
			case 'channelInputSource':
				this.state.source[ch] = enumOf(p.tail)
				break
			case 'selectedBank':
				this.state.bank = enumOf(p.tail)
				this.checkFeedbacks('bankIs')
				break
			case 'systemChannelSelected':
				this.state.selected = enumOf(p.tail)
				break
			case 'recordState':
			case 'requestRecordState':
				this.state.record = enumOf(p.tail) === 2
				this.checkFeedbacks('recording')
				break
			case 'padActive':
				this.#onPad(p.obj, boolOf(p.tail))
				break
			case 'padColourIndex': {
				// couleur changée SUR la console -> synchronise l'état (banque = objId >> 3, slot = objId & 7).
				// La couleur est POSITIONNELLE (pas l'objId du son) -> pas de calibration ici.
				const bnk = p.obj >> 3
				const pos = PAD_FALLBACK[p.obj & 0x07] ?? (p.obj & 0x07)
				if (!this.isBlinking(bnk, pos)) {
					(this.state.padColour[bnk] ??= {})[pos] = enumOf(p.tail) // ignore nos propres echos de clignotement
					this.checkFeedbacks('padColour')
				}
				dirty = false
				break
			}
			default:
				dirty = false
		}
		if (dirty) updateVariables(this)
	}

	/**
	 * Pads : la console les numérote dans l'ordre d'AFFECTATION AUDIO, pas selon leur
	 * position physique — et ça change par banque. D'où la calibration.
	 */
	#onPad(obj, on) {
		if (this.state.padSeq) {
			if (on && !this.state.padSeq.includes(obj)) {
				this.state.padSeq.push(obj)
				const n = this.state.padSeq.length
				this.log('info', `Calibration pads : ${n}/8 (banque ${this.state.padSeqBank + 1})`)
				if (n >= 8) this.finishPadCal()
			}
			return
		}
		const bank = this.state.bank
		if (this.midiMapBanks?.has(bank)) return // banque pilotée en MIDI : on ignore le HID (désordonné)
		const cal = this.state.padCal[bank] ?? {}
		const pos = cal[obj] ?? PAD_FALLBACK[obj & 0x07] ?? obj
		const active = (this.state.padActive[bank] ??= {})
		active[pos] = on                                   // état par (banque, case) : true = pad actif / maintenu
		if (on) {                                          // un relâché n'est pas un « déclenchement »
			this.state.lastPad = pos
			this.setVariableValues({ last_pad: `B${bank + 1}-${pos}` })
		}
		this.checkFeedbacks('padActive')
	}

	startPadCal(bank) {
		this.state.padSeqBank = bank ?? this.state.bank
		this.state.padSeq = []
		this.log('info',
			`Calibration banque ${this.state.padSeqBank + 1} : appuie sur tes pads dans l'ordre physique. ` +
			`Un pad VIDE n'émet rien — utilise « Terminer » s'il t'en manque.`)
	}

	finishPadCal() {
		const seq = this.state.padSeq
		if (!seq) return
		if (seq.length) {
			this.state.padCal[this.state.padSeqBank] = Object.fromEntries(seq.map((o, i) => [o, i + 1]))
			this.#savePadCal()
		}
		this.state.padSeq = null
		this.log('info', `Calibration banque ${this.state.padSeqBank + 1} terminée (${seq.length} pad(s)).`)
	}

	// ------------------------------------------------------------- apprentissage MIDI (pads latch)
	/** Config « Apprendre » : si une case est choisie, arme l'apprentissage puis vide le sélecteur. */
	#applyLearnSelection() {
		const m = /^B(\d+)P(\d+)$/.exec(this.config?.learnPad || '')
		if (!m) return false
		this.#armMidiLearn(Number(m[1]) - 1, Number(m[2]))
		this.config = { ...this.config, learnPad: '' } // remet le sélecteur à vide : n'arme qu'une fois
		this.saveConfig(this.config)
		return true // sans ce retour, configUpdated coupait et rouvrait la liaison à chaque apprentissage
	}

	/** Arme l'apprentissage : la PROCHAINE note reçue sera associée à cette case (banque, pad). */
	#armMidiLearn(bank, pad) {
		this.midiLearn = { bank, pad }
		this.setVariableValues({ midi_learn: `Appuie sur le pad B${bank + 1}P${pad}…` })
		this.log('info', `Apprentissage MIDI armé : appuie sur le pad physique (banque ${bank + 1}, pad ${pad}).`)
	}

	/** Associe la touche (note ou CC) à la case apprise, écrit le mapping dans la config (persisté + visible). */
	#learnSig(sig) {
		const { bank, pad } = this.midiLearn
		for (const s of Object.keys(this.midiMap)) {           // enlève une éventuelle ancienne touche de cette case
			if (this.midiMap[s].bank === bank && this.midiMap[s].pad === pad) delete this.midiMap[s]
		}
		this.midiMap[sig] = { bank, pad }
		this.midiMapBanks.add(bank)
		this.state.padActive[bank] = {} // efface l'état HID désordonné : la banque devient pilotée en MIDI
		this.midiLearn = null
		const str = this.#serializeMidiMap()
		this.config = { ...this.config, midiMap: str }
		this.saveConfig(this.config)
		this.setVariableValues({ midi_learn: `B${bank + 1}P${pad} = ${sig} ✓` })
		this.checkFeedbacks('padActive')
		updateVariables(this)
		this.log('info', `Pad MIDI appris : B${bank + 1}P${pad} = ${sig}. Mapping = « ${str} ».`)
	}

	/** Sérialise le mapping vers le format du champ config (« B4P8=c1.31, B1P1=n16.36 »). */
	#serializeMidiMap() {
		return Object.entries(this.midiMap)
			.map(([sig, m]) => ({ sig, bank: m.bank, pad: m.pad }))
			.sort((a, b) => a.bank - b.bank || a.pad - b.pad)
			.map((e) => `B${e.bank + 1}P${e.pad}=${e.sig}`)
			.join(', ')
	}

	// ------------------------------------------------------------- couleurs / clignotement
	/** Pose une couleur (index palette 0-15) sur une case (1-8) d'une banque (0-based) : mémorise + envoie. */
	setPadColour(bank, pad, colour) {
		(this.state.padColour[bank] ??= {})[pad] = colour
		this.send(cmd.padColour(pad, colour, bank), 'padColour')
		this.checkFeedbacks('padColour')
	}

	/** Clignotement continu (colour <-> couleur stockée) d'une case. Threads indépendants par (banque,case). */
	startBlink(bank, pad, colour, periodMs = 500) {
		this.stopBlink(bank, pad, false) // repart proprement si déjà en cours
		let on = false
		const off = this.state.padColour?.[bank]?.[pad]
		const tick = () => {
			on = !on
			this.send(cmd.padColour(pad, on ? colour : (off ?? colour), bank), 'padBlink')
		}
		tick() // allume tout de suite
		this.blinks.set(`${bank}:${pad}`, setInterval(tick, Math.max(120, periodMs)))
		this.checkFeedbacks('padBlinking')
	}

	/** Arrête le clignotement d'une case (et restaure la couleur stockée, sauf restore=false). */
	stopBlink(bank, pad, restore = true) {
		const key = `${bank}:${pad}`
		const id = this.blinks.get(key)
		if (!id) return false
		clearInterval(id)
		this.blinks.delete(key)
		if (restore) {
			const c = this.state.padColour?.[bank]?.[pad]
			if (c != null) this.send(cmd.padColour(pad, c, bank), 'padBlink restore')
		}
		this.checkFeedbacks('padBlinking')
		return true
	}

	/** Arrête TOUS les clignotements en cours. */
	stopAllBlinks() {
		for (const key of [...this.blinks.keys()]) {
			const [b, p] = key.split(':').map(Number)
			this.stopBlink(b, p)
		}
	}

	isBlinking(bank, pad) { return this.blinks.has(`${bank}:${pad}`) }

	#loadPadCal() {
		try { return JSON.parse(this.config?.padCal || '{}') } catch { return {} }
	}

	#savePadCal() {
		// persiste dans la config de l'instance (survit aux redémarrages de Companion)
		this.saveConfig({ ...this.config, padCal: JSON.stringify(this.state.padCal) })
	}

	/** Analyse le champ config « midiMap » (ex: « B4P8=c1.31, B1P1=n16.36 ») -> { signature: {bank, pad} }. */
	#parseMidiMap() {
		const map = {}
		const banks = new Set()
		const re = /B(\d+)P(\d+)\s*=\s*([nc]\d+\.\d+)/gi
		let m
		while ((m = re.exec(this.config?.midiMap || '')) !== null) {
			const bank = Number(m[1]) - 1, pad = Number(m[2])
			if (bank < 0 || bank > 5 || pad < 1 || pad > 8) continue
			map[m[3].toLowerCase()] = { bank, pad }
			banks.add(bank)
		}
		this.midiMap = map
		this.midiMapBanks = banks
	}
}

runEntrypoint(RCP2Instance, [])
