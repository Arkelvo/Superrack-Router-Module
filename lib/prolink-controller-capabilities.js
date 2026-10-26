'use strict'

// Evidence-based, fail-closed characterization of the *focused* ProLink controller.
// Field semantics are not officially documented. Live observations to date:
//   Speed / Note Transition: [true, 0, ...] and relative write works.
//   Tune Scale Type: [false, 44, ...] and relative write has no effect.
//   CLA-76 Analog: [false, 3, ...] and relative write has no effect.
// The second integer MAY be the number of enumerated choices, but is NOT
// verified to be an index, enum count, address, or safe write argument.
const FRESHNESS_MS = 3000

function characterizeFocusedController(properties) {
	const args = properties?.values
	if (!Array.isArray(args) || args.length !== 13) {
		return { kind: 'unknown', discreteCountCandidate: null, reason: 'No validated controller properties' }
	}
	if (args[1] === false) {
		return {
			kind: 'discrete_candidate', discreteCountCandidate: Number.isInteger(args[2]) && args[2] > 0 ? args[2] : null,
			reason: 'Unverified discrete controller: ChangeControllerValue accepted but did not change observed Scale Type / Analog',
		}
	}
	if (args[1] === true && args[2] === 0) {
		return {
			kind: 'relative_candidate', discreteCountCandidate: null,
			reason: 'Relative control observed working for focused Speed / Note Transition; not guaranteed for other plugins',
		}
	}
	return { kind: 'unknown', discreteCountCandidate: null, reason: 'Unrecognized properties combination' }
}

function evaluateFocusedControllerWrite({ controller, connected, pending = false, now = Date.now() }) {
	const classification = characterizeFocusedController(controller?.properties)
	const common = { ...classification, remoteParameterAddressingVerified: false }
	if (!connected) return { ...common, allowed: false, status: 'blocked_disconnected', reason: 'ProLink TCP is not connected' }
	if (!controller?.properties || !controller?.value) {
		return { ...common, allowed: false, status: 'blocked_missing_data', reason: 'No paired focused controller properties and value' }
	}
	if (classification.kind === 'discrete_candidate') {
		return { ...common, allowed: false, status: 'blocked_discrete', reason: classification.reason }
	}
	if (classification.kind !== 'relative_candidate') {
		return { ...common, allowed: false, status: 'blocked_unknown', reason: classification.reason }
	}
	const propertyAge = now - controller.properties.lastSeenAtMs
	const valueAge = now - controller.value.lastSeenAtMs
	if (!Number.isFinite(propertyAge) || !Number.isFinite(valueAge) || propertyAge < 0 || valueAge < 0 ||
		propertyAge > FRESHNESS_MS || valueAge > FRESHNESS_MS) {
		return { ...common, allowed: false, status: 'blocked_stale', reason: 'No fresh paired controller notifications in the last 3 seconds' }
	}
	// Multiple relative encoder steps are intentionally allowed while awaiting
	// feedback. Serializing them until a readback would break working Speed /
	// Note Transition controls; observations do not prove per-step causality.
	if (pending && pending.contextVersion !== controller.contextVersion) {
		return { ...common, allowed: false, status: 'blocked_context_changed', reason: 'Pending write targets a different focus revision' }
	}
	return { ...common, allowed: true, status: pending ? 'ready_relative_pending' : 'ready_relative',
		reason: 'Focus-bound relative adjustment only; feedback does not prove per-command causality' }
}

module.exports = { characterizeFocusedController, evaluateFocusedControllerWrite, FRESHNESS_MS }
