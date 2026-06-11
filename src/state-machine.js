export const VOICE_STATES = Object.freeze({ IDLE: 'idle', WARMUP: 'warmup', RECORDING: 'recording', FINALIZING: 'finalizing', ERROR: 'error' });

export function createInitialVoiceState(now = 0) {
  return { state: VOICE_STATES.IDLE, startedAt: null, recordingStartedAt: null, lastEventAt: now, mode: 'hold', error: null };
}

export function transitionVoiceState(current, event, config = {}) {
  const holdThresholdMs = config.holdThresholdMs ?? 350;
  const now = event.at ?? current.lastEventAt ?? 0;
  const next = (patch, action = null) => [{ ...current, ...patch, lastEventAt: now }, action];

  switch (event.type) {
    case 'space_down':
      if (current.state === VOICE_STATES.IDLE) return next({ state: VOICE_STATES.WARMUP, startedAt: now, mode: 'hold', error: null });
      return next({}, null);
    case 'tick':
      if (current.state === VOICE_STATES.WARMUP && current.startedAt != null && now - current.startedAt >= holdThresholdMs) {
        return next({ state: VOICE_STATES.RECORDING, recordingStartedAt: now }, 'start_recording');
      }
      return next({}, null);
    case 'space_up':
      if (current.state === VOICE_STATES.WARMUP) return next({ state: VOICE_STATES.IDLE, startedAt: null }, 'insert_space');
      if (current.state === VOICE_STATES.RECORDING) return next({ state: VOICE_STATES.FINALIZING }, 'finalize_recording');
      return next({}, null);
    case 'toggle':
      if (current.state === VOICE_STATES.IDLE) return next({ state: VOICE_STATES.RECORDING, mode: 'toggle', startedAt: now, recordingStartedAt: now, error: null }, 'start_recording');
      if (current.state === VOICE_STATES.RECORDING && current.mode === 'toggle') return next({ state: VOICE_STATES.FINALIZING }, 'finalize_recording');
      return next({}, null);
    case 'cancel':
      if (current.state === VOICE_STATES.IDLE) return next({}, null);
      return next({ state: VOICE_STATES.IDLE, startedAt: null, recordingStartedAt: null, error: null }, 'cancel_recording');
    case 'finalized':
      return next({ state: VOICE_STATES.IDLE, startedAt: null, recordingStartedAt: null, error: null }, 'insert_transcript');
    case 'empty_transcript':
      return next({ state: VOICE_STATES.IDLE, startedAt: null, recordingStartedAt: null, error: null }, 'noop_empty_transcript');
    case 'failure':
      return next({ state: VOICE_STATES.IDLE, startedAt: null, recordingStartedAt: null, error: event.error ?? 'voice failure' }, 'show_error');
    case 'timeout':
      if (current.state === VOICE_STATES.FINALIZING) return next({ state: VOICE_STATES.IDLE, error: 'finalization timeout' }, 'show_error');
      return next({}, null);
    default:
      return next({}, null);
  }
}

export class VoiceStateMachine {
  constructor(config = {}, now = 0) { this.config = config; this.current = createInitialVoiceState(now); }
  send(event) { const [state, action] = transitionVoiceState(this.current, event, this.config); this.current = state; return { state, action }; }
}
