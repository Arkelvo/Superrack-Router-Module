'use strict'

// Shared, pure arithmetic for an already verified, zero-based cyclic selector.
// These are internal raw controller values, never rack/plugin target addresses.
function isValidRaw(raw, count) {
  return Number.isInteger(count) && count >= 2 && count <= 256 &&
    Number.isInteger(raw) && raw >= 0 && raw < count
}

function nextRaw(raw, count) {
  if (!isValidRaw(raw, count)) throw new RangeError('Invalid cyclic controller raw value/count')
  return (raw + 1) % count
}

function forwardDistance(from, to, count) {
  if (!isValidRaw(from, count) || !isValidRaw(to, count)) {
    throw new RangeError('Invalid cyclic controller target/start/count')
  }
  return (to - from + count) % count
}

function buildCyclicPlan(from, to, count) {
  const steps = forwardDistance(from, to, count)
  return Object.freeze({
    from, to, count, steps,
    // Pure plan, not a command schedule. A real notification must verify each step.
    expectedRawSequence: Object.freeze(Array.from({ length: steps }, (_, index) =>
      (from + index + 1) % count)),
  })
}

function classifyStep(previous, observed, count, beforeSignature, observedSignature) {
  const expected = nextRaw(previous, count)
  if (observedSignature === beforeSignature) return { kind: 'duplicate', expected }
  if (!isValidRaw(observed, count)) return { kind: 'unexpected', expected }
  return { kind: observed === expected ? 'advance' : 'unexpected', expected }
}

module.exports = { isValidRaw, nextRaw, forwardDistance, buildCyclicPlan, classifyStep }
