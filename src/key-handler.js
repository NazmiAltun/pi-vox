export function isKey(data, key) {
  if (data === key) return true;
  if (key === 'space' && data === ' ') return true;
  if (key === 'escape' && data === '\u001b') return true;
  return false;
}

export class VoiceKeyHandler {
  constructor({ flow, machine, config = {}, clock = () => Date.now(), passThrough = () => {} } = {}) {
    this.flow = flow;
    this.machine = machine;
    this.config = config;
    this.clock = clock;
    this.passThrough = passThrough;
  }

  async handle(data, kind = 'press', originalData = data) {
    const at = this.clock();
    if (isKey(data, this.config.fallbackToggleShortcut ?? 'ctrl+shift+v')) return this.apply({ type: 'toggle', at });
    if (isKey(data, this.config.cancelShortcut ?? 'escape')) {
      const result = await this.apply({ type: 'cancel', at });
      if (!result.handled) this.passThrough(originalData);
      return result;
    }
    if (isKey(data, 'space')) return this.apply({ type: kind === 'release' ? 'space_up' : 'space_down', at }, originalData);
    this.passThrough(originalData);
    return { handled: false };
  }

  async tick() { return this.apply({ type: 'tick', at: this.clock() }); }

  async apply(event, originalData = ' ') {
    const { action } = this.machine.send(event);
    if (action === 'insert_space') this.passThrough(originalData);
    if (action === 'start_recording') {
      try {
        await this.flow.startRecording();
      } catch (error) {
        this.machine.send({ type: 'failure', at: this.clock(), error: error instanceof Error ? error.message : String(error) });
        await this.flow.fail?.(error);
      }
    }
    if (action === 'finalize_recording') {
      try {
        const result = await this.flow.finalizeRecording();
        this.machine.send({ type: result?.inserted ? 'finalized' : 'empty_transcript', at: this.clock() });
      } catch (error) {
        this.machine.send({ type: 'failure', at: this.clock(), error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (action === 'cancel_recording') await this.flow.cancel();
    return { handled: Boolean(action), action };
  }
}
