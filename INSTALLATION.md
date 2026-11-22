# Installer le module Companion RØDECaster Pro II (version 0.1.0)

Ce module n'est pas dans la liste officielle de Companion : il s'installe à la main, une fois par poste.
Il pilote une RØDECaster Pro II branchée en USB : mute, PFL, enregistrement, pads (lancement, couleur,
clignotement), banques, retour d'état, et la position des faders en MIDI. Développé sur le firmware 1.7.3 : avec un
autre firmware, le module refuse de se connecter (option **Refuser un autre firmware**, cochée d'office).

Fichier fourni : `rode-rodecaster-pro2-0.1.0.tgz`. Il faut **Bitfocus Companion 4 ou plus récent** (essayé avec la
5.0.2), sous Windows, macOS ou Linux : les pilotes USB et MIDI sont dans le paquet.

## 1. Importer le module

**Depuis le PC où tourne Companion** : l'import depuis un autre ordinateur est refusé par défaut.

1. Ouvrir l'interface de Companion (le bouton « Launch GUI » de la fenêtre de Companion).
2. Aller dans **Modules**.
3. Cliquer sur **Import module package**, puis choisir `rode-rodecaster-pro2-0.1.0.tgz`.
4. Le module **RØDECaster Pro II** apparaît dans la liste, en version 0.1.0.

## 2. Brancher et créer la connexion

1. La console se branche en **USB sur le PC où tourne Companion**. Il n'y a pas de contrôle par le réseau.
2. Dans **Connections**, chercher **RØDECaster Pro II**, puis **Add**.
3. Laisser cochée l'option **Réveiller le flux** : sans elle, la console ne renvoie rien. À noter :
   au démarrage de Companion, ce réveil remet la console sur la banque 1.
4. Enregistrer. La connexion passe au vert quand la console est trouvée et que son port MIDI est ouvert. Elle reste
   jaune si seul le MIDI manque.

## 3. Les pads

Un bouton de pad joue le pad de la banque affichée sur la console, sans rien régler.

Pour le témoin « Pad — actif », c'est différent : la console désigne les pads dans l'ordre de leur affectation audio,
pas selon leur place. Il faut donc les calibrer, une fois par banque :
1. mettre la console sur la banque voulue ;
2. lancer l'action **Pads — démarrer la calibration** ;
3. appuyer sur les pads dans l'ordre physique voulu ;
4. au 8e pad, la calibration s'arrête seule. Sinon, lancer **Pads — terminer la calibration** : un pad vide ne
   renvoie rien.

Les pads en mode MIDI s'apprennent dans la configuration de la connexion : choisir la case, enregistrer, puis
appuyer sur le pad.

## Si ça ne marche pas

- **Connexion rouge, « firmware » dans le message** : la console n'est pas en 1.7.3. Pour essayer quand même,
  décocher **Refuser un autre firmware** : des commandes peuvent alors rester sans effet.
- **Connexion rouge** : la console est-elle branchée sur ce PC et allumée ? Un seul logiciel peut tenir la liaison
  USB HID à la fois. Si un autre outil RØDECaster tourne, le fermer.
- **Connexion jaune, faders muets** : le port MIDI ne s'ouvre que dans un seul logiciel à la fois. Si un autre le
  tient, le fermer, ou décocher **Lire les faders (MIDI)** : le reste continue de marcher, sans la
  position des faders ni le suivi des pads en mode MIDI. Si aucun logiciel ne le tient, débrancher puis rebrancher
  le câble USB.
- **Ports MIDI qui se multiplient sous Windows** : garder toujours la même prise USB pour la console.

## Pour l'équipe : refaire le paquet

Dans `D:\dev\companion-module-rode-rodecaster-pro2` : `npm install`, puis `npx companion-module-build`. Le fichier
sort sous le nom `pkg.tgz` : le renommer en `rode-rodecaster-pro2-<version>.tgz`. `build-config.cjs` y ajoute les
pilotes natifs (`node-hid`, `@julusian/midi`). Mettre la version dans `package.json` et `companion/manifest.json`
avant.
