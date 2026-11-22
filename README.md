# companion-module-rode-rodecaster-pro2

Module [Bitfocus Companion](https://bitfocus.io/companion) pour le **RØDECaster Pro II**.

> ### ⚠️ Cadrage : firmware **1.7.3**
> RØDE ne publie **aucun protocole de contrôle externe** pour cette console. Tout ce
> module repose sur un **reverse-engineering** de l'USB HID, réalisé et validé sur le
> **firmware 1.7.3**. Les identifiants d'objets (`objId`) sont **empiriques, pas
> contractuels** : une mise à jour du firmware peut les déplacer sans préavis.
>
> **La version est vérifiée automatiquement** : elle est portée par le descripteur USB
> (`bcdDevice`, ex. `0x0173` → `1.7.3`). Le module la lit au branchement, l'expose dans
> la variable `$(rode-rodecaster-pro2:firmware)` et **refuse de se connecter** si ce n'est pas
> la version de référence. Pour essayer quand même un autre firmware, décocher l'option
> *Refuser un autre firmware* : le module se connecte alors avec un simple avertissement.

C'est précisément ce blocage (« *no external protocol* », « *missing documentation* »)
qui laissait les demandes de module ouvertes depuis 2022 côté Bitfocus.

## Ce que le module apporte

| | |
|---|---|
| **Contrôle** | mute, PFL/cue, enregistrement, pads (appui bref ou maintien), couleur et clignotement des pads, banques, sélection de canal, gain d'entrée, encodeur |
| **Retour d'état** | mute, PFL, enregistrement, banque active, canal sélectionné, source par canal, pads actifs, couleur des pads |
| **Faders** | position **absolue** de chaque fader, lue en MIDI (CC15, canal MIDI N pour le fader N) |
| **Feedbacks** | boutons qui s'allument selon l'état réel (muté, PFL, REC, banque, voie ouverte, **pad actif**, pad qui clignote), et fond du bouton à la couleur du pad |
| **Variables** | `fader_N`, `fader_N_pct`, `mute_N`, `pfl_N`, `source_N`, `pad_active_bB_pP` (6×8), `midi_last`, `midi_learn`, `bank`, `record`, `selected_channel`, `last_pad`, `firmware`, `serial` |
| **Presets** | boutons prêts à l'emploi (mutes, PFL, pads en appui bref, en maintien ou avec témoin, banques, REC, témoins de faders, calibration des pads) |

La console a 9 canaux, 6 banques de 8 pads et 16 couleurs de pad. Un bouton de pad joue le pad
de la **banque affichée sur la console**. La couleur et le clignotement, eux, se règlent sur
n'importe quelle banque.

## Deux points décisifs

**1. Le réveil du flux.** La console ne diffuse **absolument rien** tant qu'elle n'a pas
reçu une commande. C'est très probablement pourquoi les tentatives précédentes
« n'étaient pas stables » : on se connecte, et aucun retour n'arrive. Le module envoie
donc un choix de banque (`selectedBank`) à la connexion. Conséquence : au démarrage de
Companion, la console revient sur la **banque 1** ; après une coupure, sur la dernière banque
connue. *(Option « Réveiller le flux » — à laisser cochée.)*

**2. Le témoin des pads demande une calibration.** Jouer un pad marche tout de suite. Mais
quand la console annonce qu'un pad joue, elle le désigne dans l'ordre d'**affectation audio**,
**pas** selon sa position physique — et cet ordre **change d'une banque à l'autre**. Pour que
le feedback « Pad — actif » et les variables `pad_active_…` et `last_pad` tombent sur la bonne
case, il faut calibrer, une fois par banque :

1. Mettre la console sur la banque voulue.
2. Action **« Pads — démarrer la calibration »** (choisir la banque).
3. Appuyer sur les pads **dans l'ordre physique** souhaité.
4. À 8 pads c'est automatique ; sinon **« Pads — terminer la calibration »**
   (⚠️ un pad **vide n'émet rien**, donc on n'atteint pas toujours 8).

La calibration est enregistrée dans la configuration de l'instance.

**Pads en mode MIDI / latch.** Un pad réglé pour sortir du **MIDI** envoie une **touche propre
à chaque case** — Note **ou** Control Change (CC), selon la config console. L'apprentissage se
fait **dans la config de la connexion**, sans bouton ni calibration :

1. Liste **« Apprendre ce pad »** → choisir p. ex. *Banque 4 · Pad 8*.
2. Cliquer **Save**.
3. Appuyer sur le **pad physique** correspondant : sa touche s'enregistre toute seule dans le champ
   **« Correspondance touche ↔ pad »** (format `B4P8=c1.31` pour un CC, `B4P8=n16.43` pour une note).

Ces pads alimentent alors le feedback **« Pad — actif »** et les variables `pad_active_bX_pY`,
exactement comme les pads audio. *(La variable `midi_last` montre la touche reçue, `midi_learn`
confirme l'apprentissage ; une banque avec des pads MIDI mappés ignore le retour HID désordonné.)*

**Couleur des pads.** Le module ne connaît la couleur d'une case que s'il l'a réglée lui-même
(action « Pad — couleur ») ou si quelqu'un l'a changée sur la console depuis la connexion. Tant
qu'il ne la connaît pas, le feedback « Pad — refléter la couleur » donne un fond gris et un
clignotement ne se voit pas : régler d'abord la couleur de la case.

## Installation

Connexion en **USB** : Companion doit tourner sur la machine où la console est branchée.

Sur un poste, on importe le paquet [rode-rodecaster-pro2-0.1.1.tgz](rode-rodecaster-pro2-0.1.1.tgz) (à télécharger
ici) : voir [INSTALLATION.md](INSTALLATION.md).
Pour développer :

```bash
git clone <ce dépôt>
cd companion-module-rode-rodecaster-pro2
npm install
```

Dans Companion : **Settings → Developer modules path** → dossier parent, puis ajouter
l'instance **RØDECaster Pro II**.

## Limites connues

- **USB uniquement** — pas de contrôle réseau, donc pas d'usage en satellite distant.
- **Port MIDI exclusif** : un seul logiciel à la fois peut le tenir. Si un autre outil
  l'utilise, décocher *Lire les faders (MIDI)* : le HID continue de fonctionner,
  mais on perd la position des faders et le suivi des pads en mode MIDI.
- **Faders en écriture** : non exposés en absolu. Le déplacement passe par l'émulation
  de l'encodeur, qui est **relative au canal actuellement pointé** — d'où l'action
  *Encodeur — rotation* plutôt qu'un « mettre le fader à X % » qui serait trompeur.
- **`systemChannelSelected = 0xff` est interdit** : cette valeur a fait **redémarrer**
  une console pendant le reverse. Le module ne l'envoie jamais.

## Le HID est muet — mauvaise interface ouverte

Symptôme : la connexion paraît établie, le **MIDI fonctionne**, mais aucun retour HID
(mute, pads, banques) n'arrive et les commandes restent sans effet. Typiquement **après un
redémarrage** du PC.

Cause : la console expose **plusieurs** interfaces HID en `usagePage 0xff00`. Sur une machine
réelle on a relevé `PID 0x0026` en **interface 3** (« RØDECaster Pro II ») à côté de la vraie
`PID 0x0092` en **interface 9** (« HID Interface »). Sélectionner sur le seul `usagePage` dépend
alors de l'**ordre d'énumération USB**, qu'un redémarrage suffit à inverser — et on ouvre la
mauvaise interface, qui ne dit jamais rien.

Le module **priorise désormais l'interface 9** (l'`usagePage` n'est qu'un repli) et **journalise
l'interface retenue** à la connexion :

```
Connecté — interface 9 (PID 0x0092, « HID Interface »), firmware de référence 1.7.3
```

Si cette ligne annonce autre chose que l'**interface 9**, c'est la piste à suivre en priorité.

## Le MIDI a « sauté » — port fantôme Windows

Symptôme : la connexion passe au **jaune**, plus de position de fader ni de pads MIDI,
alors que le HID (mute, pads, banques) continue de marcher. Windows liste toujours le port
`MIDI function` mais **refuse de l'ouvrir**, sans qu'aucun logiciel ne le tienne.

Cause : à force de brancher la console sur des prises USB différentes, Windows accumule des
enregistrements périmés. L'un de ces **fantômes** occupe le nom `MIDI function` et masque le
vrai périphérique (souvent enregistré sous `2 - MIDI function`).

**Remède : débrancher/rebrancher le câble USB** — ça force la ré-énumération et recrée un port
vivant. *(Équivalent : Gestionnaire de périphériques → « MIDI function » → Désactiver/Réactiver.)*
Aucun logiciel ne peut le faire à sa place : il n'existe pas d'API pour réveiller un port mort.

Pour distinguer un fantôme d'un port réellement occupé — le statut de la connexion le dit déjà,
mais on peut le vérifier hors Companion (à faire **connexion désactivée**, le MIDI étant exclusif) :

```bash
node -e "import('@julusian/midi').then(m=>{const I=(m.default??m).Input;const p=new I();for(let i=0;i<p.getPortCount();i++){const t=new I();let v='REFUSE';try{t.openPort(i);v='OUVRABLE';t.closePort()}catch(e){}try{t.destroy()}catch(e){}console.log(i,p.getPortName(i),'->',v)}})"
```

Si un **autre** port (ex. `loopMIDI Port`) s'ouvre et que seul celui du RØDECaster refuse, c'est
un fantôme → rebrancher. Le module, lui, essaie **toutes** les entrées portant le nom cherché et
garde la première qui s'ouvre vraiment : un fantôme ne masque plus le vrai port.

Prévention : purger les fantômes (Gestionnaire de périphériques → *Affichage → Afficher les
périphériques cachés* → désinstaller les `MIDI function` grisés) et **garder toujours la même
prise USB** pour la console.

## Licence

MIT.
