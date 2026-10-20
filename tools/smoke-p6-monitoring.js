'use strict'
const assert = require('node:assert/strict')
const { ProLinkObservations } = require('../lib/prolink-observations')
const { isValidRawReply, MONITOR_POLL_INTERVAL_MS } = require('../lib/prolink-monitoring')

function fake() {
  const values = {}
  const sent = []
  const log = []
  const instance = {
    config: { controlTransport: 'prolink' },
    _destroyed: false,
    _prolinkReady: true,
    _prolink: {
      state: 'waiting', sequence: 0,
      onState(state) { this.state = state },
      send(command, value) {
        if (this.state !== 'connected') throw new Error('disconnected')
        const sequence = this.sequence++
        sent.push({ command, value, sequence })
        return sequence
      },
    },
    setVariableValues(next) { Object.assign(values, next) },
    checkFeedbacks() {}, updateActions() {},
    _log(level, message, detail) { log.push({ level, message, detail }) },
  }
  instance._prolinkObservations = new ProLinkObservations(instance)
  return { instance, obs: instance._prolinkObservations, values, sent, log }
}

async function main() {
  assert.equal(MONITOR_POLL_INTERVAL_MS, 15000)
  assert.equal(isValidRawReply([1, true, 'x']), true)
  assert.equal(isValidRawReply([Infinity]), false)
  assert.equal(isValidRawReply([]), false)
  const { instance, obs, values, sent } = fake()
  instance._prolink.onState('connected')
  assert.deepEqual(sent.map(x => x.command), [
    'GetListOfSnapshots','RequestControllerInfoUpdates','GetCPUUsage','GetSessionDirtyState'
  ])
  assert.equal(values.prolink_monitor_cpu_status, 'requesting')
  assert.equal(values.prolink_monitor_session_dirty_status, 'requesting')
  instance._prolink.onState('connected')
  assert.equal(sent.length, 4)
  obs.monitoring.poll()
  assert.equal(sent.length, 4) // No overlapping poll
  const cpu = sent.find(x => x.command === 'GetCPUUsage')
  const dirty = sent.find(x => x.command === 'GetSessionDirtyState')
  obs.observeReply('GiveCPUUsage',[cpu.sequence, 21.5, 'unknown scale'])
  obs.observeReply('GiveSessionDirtyState',[dirty.sequence, false])
  assert.equal(values.prolink_monitor_cpu_args_json,'[21.5,"unknown scale"]')
  assert.equal(values.prolink_monitor_cpu_known,true)
  assert.equal(values.prolink_monitor_session_dirty_args_json,'[false]')
  assert.equal(obs.monitoring.hasIssue(), false)
  obs.observeStatus('NotifySnapshotDirty','prolink_snapshot_dirty',[true])
  assert.equal(values.prolink_snapshot_dirty,true)
  assert.equal(typeof values.prolink_monitor_last_status_change_ms,'number')
  instance._prolink.onState('waiting')
  assert.equal(values.prolink_monitor_cpu_known,false)
  assert.equal(values.prolink_monitor_cpu_args_json,'')
  assert.equal(obs.monitoring.timer,null)
  assert.equal(obs.monitoring.pending.size,0)
  instance._prolink.onState('connected')
  assert.equal(values.prolink_monitor_connection_count,2)
  assert.equal(sent.filter(x => x.command === 'GetCPUUsage').length, 2)
  obs.monitoring.stop()
  obs.reset()
  process.stdout.write('P6 monitoring smoke passed\n')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
