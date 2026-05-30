/* tslint:disable */
/* eslint-disable */

/**
 * Clear the currently stored template.
 */
export function clear_template(): void;

/**
 * Compute the integral image of the red channel (for debugging).
 */
export function compute_integral(data: Uint8Array, img_w: number, img_h: number): Uint32Array;

/**
 * Set detection parameters from JavaScript (JSON string).
 */
export function configure(json_config: string): void;

/**
 * Legacy single‑result detection (returns `"x,y,w,h"` string).
 */
export function detect_single(data: Uint8Array, img_w: number, img_h: number): string;

/**
 * Primary detection entry point. Returns JSON array of matches.
 */
export function detect_template(data: Uint8Array, img_w: number, img_h: number): string;

/**
 * Get the current configuration as a JSON string.
 */
export function get_config(): string;

/**
 * Get template dimensions (JSON: `{"width":N,"height":N}` or `null`).
 */
export function get_template_info(): string;

/**
 * Greet – used for smoke‑testing the WASM bridge.
 */
export function greet(name: string): string;

/**
 * Check whether a template has been set.
 */
export function has_template(): boolean;

export function main(): void;

/**
 * Reset configuration to defaults.
 */
export function reset_config(): void;

/**
 * Store a template from raw RGBA pixel data.
 */
export function set_template(data: Uint8Array, width: number, height: number): void;

/**
 * Get the WASM module version.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly compute_integral: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly configure: (a: number, b: number, c: number) => void;
    readonly detect_single: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly detect_template: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly get_config: (a: number) => void;
    readonly get_template_info: (a: number) => void;
    readonly greet: (a: number, b: number, c: number) => void;
    readonly has_template: () => number;
    readonly reset_config: () => void;
    readonly set_template: (a: number, b: number, c: number, d: number) => void;
    readonly version: (a: number) => void;
    readonly main: () => void;
    readonly clear_template: () => void;
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
