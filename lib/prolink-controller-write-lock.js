'use strict'

// Only a cyclic state machine may issue its own SwitchControllerValue frame
// while it owns the focused controller. Competing callers must be rejected.
const CONTROLLER_COMMANDS = new Set(['SwitchControllerValue', 'ChangeControllerValue'])
function blocksCompetingControllerWrite(command, tuneScaleControl, discreteControl) {
  if (!CONTROLLER_COMMANDS.has(command)) return false
  return !!((tuneScaleControl?.pending && !tuneScaleControl.sending) ||
    (discreteControl?.pending && !discreteControl.sending))
}
module.exports = { blocksCompetingControllerWrite }
