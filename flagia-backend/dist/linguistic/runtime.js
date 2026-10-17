"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.linguisticRuntime = exports.LinguisticRuntime = void 0;
exports.linguisticModelVersion = linguisticModelVersion;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_readline_1 = require("node:readline");
const node_crypto_1 = require("node:crypto");
const root = node_path_1.default.resolve(__dirname, '../..');
const modelDirectory = node_path_1.default.resolve(process.env.FLAGIA_LINGUISTIC_MODEL_DIR || node_path_1.default.join(root, '.linguistic-local/model'));
const python = process.env.FLAGIA_LINGUISTIC_PYTHON || node_path_1.default.join(root, '.venv-linguistic/bin/python');
function linguisticModelVersion() {
    try {
        const manifest = JSON.parse((0, node_fs_1.readFileSync)(node_path_1.default.join(modelDirectory, 'manifest.json'), 'utf8'));
        return typeof manifest.modelVersion === 'string' ? manifest.modelVersion : 'unavailable';
    }
    catch {
        return 'unavailable';
    }
}
/** One private resident model, bounded queue, asynchronous IPC. Text stays local. */
class LinguisticRuntime {
    child = null;
    queue = [];
    current = null;
    ready = false;
    timer = null;
    loadedVersion = '';
    run(input, onStage = () => { }) {
        if (this.queue.length >= 64)
            return Promise.resolve({ status: 'unevaluated', reason: 'busy', modelVersion: linguisticModelVersion() });
        return new Promise(resolve => {
            this.queue.push({ id: (0, node_crypto_1.randomUUID)(), input, onStage, resolve });
            this.pump();
        });
    }
    fail(reason) {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
        const child = this.child;
        this.child = null;
        this.ready = false;
        child?.kill();
        const jobs = [...(this.current ? [this.current] : []), ...this.queue];
        this.current = null;
        this.queue = [];
        for (const job of jobs)
            job.resolve({ status: 'unevaluated', reason, modelVersion: linguisticModelVersion() });
    }
    pump() {
        if (this.current || !this.queue.length)
            return;
        const version = linguisticModelVersion();
        if (this.child && this.ready && this.loadedVersion !== version) {
            const old = this.child;
            this.child = null;
            this.ready = false;
            old.kill();
        }
        if (!this.child) {
            if (version === 'unavailable' || !(0, node_fs_1.existsSync)(python)) {
                this.fail('model_unavailable');
                return;
            }
            const child = (0, node_child_process_1.spawn)(python, ['-u', node_path_1.default.join(root, 'linguistic/worker.py'), modelDirectory], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', TOKENIZERS_PARALLELISM: 'false' },
            });
            this.child = child;
            this.queue.forEach(j => j.onStage('loading'));
            this.timer = setTimeout(() => this.fail('timeout'), 90000);
            // Consume stderr without logging user content or local paths.
            child.stderr.on('data', () => { });
            child.on('error', () => { if (this.child === child)
                this.fail('model_unavailable'); });
            child.stdin.on('error', () => { if (this.child === child)
                this.fail('worker_exited'); });
            child.on('exit', () => { if (this.child === child)
                this.fail('worker_exited'); });
            const lines = (0, node_readline_1.createInterface)({ input: child.stdout });
            lines.on('line', line => {
                if (this.child !== child)
                    return;
                try {
                    const message = JSON.parse(line);
                    if (message.fatal) {
                        this.fail('model_unavailable');
                        return;
                    }
                    if (message.ready) {
                        if (message.modelVersion !== version) {
                            this.fail('model_changed');
                            return;
                        }
                        if (this.timer)
                            clearTimeout(this.timer);
                        this.ready = true;
                        this.loadedVersion = version;
                        this.pump();
                        return;
                    }
                    if (!this.current || message.id !== this.current.id)
                        return;
                    if (['features', 'context', 'revisions'].includes(message.stage))
                        this.current.onStage(message.stage);
                    if (message.result) {
                        if (this.timer)
                            clearTimeout(this.timer);
                        const job = this.current;
                        this.current = null;
                        job.resolve({ ...message.result, modelVersion: version });
                        this.pump();
                    }
                }
                catch {
                    this.fail('invalid_worker_result');
                }
            });
        }
        if (!this.ready)
            return;
        this.current = this.queue.shift();
        this.timer = setTimeout(() => this.fail('timeout'), 120000);
        this.child.stdin.write(JSON.stringify({ id: this.current.id, ...this.current.input }) + '\n', error => {
            if (error)
                this.fail('worker_exited');
        });
    }
    close() { this.fail('worker_stopped'); }
}
exports.LinguisticRuntime = LinguisticRuntime;
exports.linguisticRuntime = new LinguisticRuntime();
//# sourceMappingURL=runtime.js.map