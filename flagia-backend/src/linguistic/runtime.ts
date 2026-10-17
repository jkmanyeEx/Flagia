import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { LinguisticStage, WorkerResult } from './types';

const root = path.resolve(__dirname, '../..');
const modelDirectory = path.resolve(process.env.FLAGIA_LINGUISTIC_MODEL_DIR || path.join(root, '.linguistic-local/model'));
const python = process.env.FLAGIA_LINGUISTIC_PYTHON || path.join(root, '.venv-linguistic/bin/python');

export function linguisticModelVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(path.join(modelDirectory, 'manifest.json'), 'utf8'));
    return typeof manifest.modelVersion === 'string' ? manifest.modelVersion : 'unavailable';
  } catch { return 'unavailable'; }
}

interface Job {
  id: string;
  input: { text: string; mode: string; states: { text: string; timestamp: number }[] };
  onStage: (stage: LinguisticStage) => void;
  resolve: (result: WorkerResult) => void;
}

/** One private resident model, bounded queue, asynchronous IPC. Text stays local. */
export class LinguisticRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private queue: Job[] = [];
  private current: Job | null = null;
  private ready = false;
  private timer: NodeJS.Timeout | null = null;
  private loadedVersion = '';

  run(input: Job['input'], onStage: Job['onStage'] = () => {}): Promise<WorkerResult> {
    if (this.queue.length >= 64) return Promise.resolve({ status: 'unevaluated', reason: 'busy', modelVersion: linguisticModelVersion() });
    return new Promise(resolve => {
      this.queue.push({ id: randomUUID(), input, onStage, resolve });
      this.pump();
    });
  }

  private fail(reason: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const child = this.child;
    this.child = null; this.ready = false;
    child?.kill();
    const jobs = [...(this.current ? [this.current] : []), ...this.queue];
    this.current = null; this.queue = [];
    for (const job of jobs) job.resolve({ status: 'unevaluated', reason, modelVersion: linguisticModelVersion() });
  }

  private pump() {
    if (this.current || !this.queue.length) return;
    const version = linguisticModelVersion();
    if (this.child && this.ready && this.loadedVersion !== version) {
      const old = this.child; this.child = null; this.ready = false; old.kill();
    }
    if (!this.child) {
      if (version === 'unavailable' || !existsSync(python)) { this.fail('model_unavailable'); return; }
      const child = spawn(python, ['-u', path.join(root, 'linguistic/worker.py'), modelDirectory], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false' },
      });
      this.child = child;
      this.queue.forEach(j => j.onStage('loading'));
      this.timer = setTimeout(() => this.fail('timeout'), 90000);
      // Consume stderr without logging user content or local paths.
      child.stderr.on('data', () => {});
      child.on('error', () => { if (this.child === child) this.fail('model_unavailable'); });
      child.stdin.on('error', () => { if (this.child === child) this.fail('worker_exited'); });
      child.on('exit', () => { if (this.child === child) this.fail('worker_exited'); });
      const lines = createInterface({ input: child.stdout });
      lines.on('line', line => {
        if (this.child !== child) return;
        try {
          const message = JSON.parse(line);
          if (message.fatal) { this.fail('model_unavailable'); return; }
          if (message.ready) {
            if (message.modelVersion !== version) { this.fail('model_changed'); return; }
            if (this.timer) clearTimeout(this.timer);
            this.ready = true; this.loadedVersion = version; this.pump(); return;
          }
          if (!this.current || message.id !== this.current.id) return;
          if (['features', 'context', 'revisions'].includes(message.stage)) this.current.onStage(message.stage);
          if (message.result) {
            if (this.timer) clearTimeout(this.timer);
            const job = this.current; this.current = null;
            job.resolve({ ...message.result, modelVersion: version });
            this.pump();
          }
        } catch { this.fail('invalid_worker_result'); }
      });
    }
    if (!this.ready) return;
    this.current = this.queue.shift()!;
    this.timer = setTimeout(() => this.fail('timeout'), 120000);
    this.child!.stdin.write(JSON.stringify({ id: this.current.id, ...this.current.input }) + '\n', error => {
      if (error) this.fail('worker_exited');
    });
  }

  close() { this.fail('worker_stopped'); }
}

export const linguisticRuntime = new LinguisticRuntime();
