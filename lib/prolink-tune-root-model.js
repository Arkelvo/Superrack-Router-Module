'use strict'

// Statically recovered from the Waves Tune Real-Time 17.1.42.50
// DisplayAllPossibleRootNotesNames table and automation parameter 82.
// These indices are NOT OSC controller addresses or MIDI channel numbers.
// In particular, host controller index 40 is not interchangeable with 82.
const ROOT_SPELLINGS = Object.freeze([
  ['C', 0, 0], ['C#', 1, 1], ['Db', 2, 1], ['D', 3, 2],
  ['D#', 4, 3], ['Eb', 5, 3], ['E', 6, 4], ['F', 7, 5],
  ['F#', 8, 6], ['Gb', 9, 6], ['G', 10, 7], ['G#', 11, 8],
  ['Ab', 12, 8], ['A', 13, 9], ['A#', 14, 10], ['Bb', 15, 10],
  ['B', 16, 11],
].map(([id, automationIndex, pitchClass]) => Object.freeze({
  id, label: id, automationIndex, pitchClass,
})))
const ROOT_BY_ID = new Map(ROOT_SPELLINGS.map(item => [item.id, item]))
const STATIC_SOURCE = Object.freeze({
  source: 'superrack-reverse-engineering/deep-analysis.md: Tune Root Notes / DisplayAllPossibleRootNotesNames',
  tuneBinaryVersion: '17.1.42.50',
  rootAutomationParameterId: 82,
  rootNativeHostControllerIndexCandidate: 40,
  indexMeaning: 'Tune automation enumeration, NOT OSC parameter ID, MIDI CC, MIDI channel, or note number',
  evidence: 'confirmed_static_not_live',
})

function buildRootCapabilityReport({ requestedRoot = null, connected = false, controllerState = null } = {}) {
  const requested = requestedRoot == null ? null : ROOT_BY_ID.get(requestedRoot)
  if (requestedRoot != null && !requested) throw new RangeError('Unknown root spelling')
  const p = controllerState?.properties?.values
  const v = controllerState?.value?.values
  // A generic Touch-and-Turn notification is NOT an addressable Root getter.
  // Do not try to infer the last root note from a focused Scale Type or Speed.
  return {
    source: 'Tune Root read-only capability / static enumeration',
    ...STATIC_SOURCE,
    connected: Boolean(connected),
    currentRootKnown: false,
    remoteRootGetterVerified: false,
    remoteRootSetterVerified: false,
    networkRootTargetAddressVerified: false,
    selected: requested ?? null,
    supportedSpellings: ROOT_SPELLINGS,
    observedTouchAndTurn: {
      name: Array.isArray(p) ? p[0] ?? null : null,
      pluginLabel: Array.isArray(p) ? p[10] ?? null : null,
      valueText: Array.isArray(v) ? v[0] ?? null : null,
      valueRaw: Array.isArray(v) ? v[1] ?? null : null,
      contextVersion: controllerState?.contextVersion ?? null,
    },
    blockReason: 'No externally registered ProLink root getter/setter or safe rack/slot/parameter target is verified; no command was sent.',
  }
}
module.exports = { ROOT_SPELLINGS, ROOT_BY_ID, STATIC_SOURCE, buildRootCapabilityReport }
