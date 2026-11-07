/** Short, local synthesized completion cue. No remote assets or autoplay are involved. */
export async function playCompletionSound(): Promise<void> {
  const AudioContextConstructor = globalThis.AudioContext;
  if (!AudioContextConstructor) return;

  let context: AudioContext | undefined;
  try {
    context = new AudioContextConstructor();
    if (context.state === 'suspended') await context.resume();
    const now = context.currentTime;
    const notes = [
      { frequency: 660, start: 0, duration: 0.09 },
      { frequency: 880, start: 0.105, duration: 0.12 },
    ];
    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, now + note.start);
      gain.gain.setValueAtTime(0.0001, now + note.start);
      gain.gain.exponentialRampToValueAtTime(0.075, now + note.start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + note.start);
      oscillator.stop(now + note.start + note.duration + 0.01);
    }
    await new Promise<void>(resolve => globalThis.setTimeout(resolve, 260));
  } catch {
    // Audio is optional; a missing or blocked audio device must not affect task durability.
  } finally {
    if (context && context.state !== 'closed') await context.close().catch(() => undefined);
  }
}
