// paquet Companion (.tgz) : les deux pilotes natifs (USB HID et MIDI) sont livrés avec leurs prebuilds
// (pkg-prebuilds), copiés à côté de main.js par companion-module-build.
module.exports = {
	prebuilds: ['node-hid', '@julusian/midi'],
}
