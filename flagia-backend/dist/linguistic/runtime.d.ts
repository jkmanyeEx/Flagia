import type { LinguisticStage, WorkerResult } from './types';
export declare function linguisticModelVersion(): string;
interface Job {
    id: string;
    input: {
        text: string;
        mode: string;
        states: {
            text: string;
            timestamp: number;
        }[];
    };
    onStage: (stage: LinguisticStage) => void;
    resolve: (result: WorkerResult) => void;
}
/** One private resident model, bounded queue, asynchronous IPC. Text stays local. */
export declare class LinguisticRuntime {
    private child;
    private queue;
    private current;
    private ready;
    private timer;
    private loadedVersion;
    run(input: Job['input'], onStage?: Job['onStage']): Promise<WorkerResult>;
    private fail;
    private pump;
    close(): void;
}
export declare const linguisticRuntime: LinguisticRuntime;
export {};
//# sourceMappingURL=runtime.d.ts.map