/* tslint:disable */
/* eslint-disable */

/**
 * Configure the detection engine from a JSON string matching `DetectionConfig`.
 * Unknown fields are silently ignored; missing fields use current values as defaults.
 */
export function configure(json: string): void;

/**
 * Run detection on a frame (raw RGBA, row-major).
 * Returns a JSON string containing a `DetectionResult`.
 */
export function detect_template(data: Uint8Array, img_w: number, img_h: number): string;

/**
 * Return the current config as JSON (useful for inspector panels).
 */
export function get_config(): string;

/**
 * Return a diagnostics snapshot as JSON.
 */
export function get_diagnostics(): string;

/**
 * Return trajectory data for all confirmed trackers as JSON.
 */
export function get_trajectories(): string;

/**
 * Returns true if a template is currently loaded.
 */
export function has_template(): boolean;

export function main(): void;

/**
 * Reset engine state: clears template, trackers, and frame counter.
 */
export function reset(): void;

/**
 * Convenience setter for fusion weights without a full reconfigure.
 */
export function set_fusion_weights(ncc: number, hog: number, hist: number): void;

/**
 * Load and precompute a template from raw RGBA pixel data.
 * Clears all existing trackers.
 */
export function set_template(data: Uint8Array, width: number, height: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly configure: (a: number, b: number, c: number) => void;
    readonly detect_template: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly get_config: (a: number) => void;
    readonly get_diagnostics: (a: number) => void;
    readonly get_trajectories: (a: number) => void;
    readonly has_template: () => number;
    readonly reset: () => void;
    readonly set_template: (a: number, b: number, c: number, d: number) => void;
    readonly main: () => void;
    readonly set_fusion_weights: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
