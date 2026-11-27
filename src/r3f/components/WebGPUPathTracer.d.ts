import type { WebGPUPathTracer as WebGPUPathTracerImpl, WebGPUPathTracerEventMap } from '../../webgpu/index.js';
import type {
	ReactNode,
	Context,
	ForwardRefExoticComponent,
	RefAttributes,
} from 'react';

export declare const WebGPUPathTracerContext: Context<WebGPUPathTracerImpl | null>;

export declare function usePathTracer(): WebGPUPathTracerImpl | null;

// dynamically mapping keys of WebGPUPathTracerEventMap to onCamelCased
type CamelCase<S extends string> = S extends `${ infer T }-${ infer U }`
	? `${ T }${ Capitalize<CamelCase<U>> }`
	: S;

type EventHandler<K extends keyof WebGPUPathTracerEventMap> = (
	event: WebGPUPathTracerEventMap[K],
) => void;

type WebGPUPathTracerEventMapForR3f = {
	[K in keyof WebGPUPathTracerEventMap as `on${ Capitalize<CamelCase<K>> }`]?: EventHandler<K>;
};

interface WebGPUPathTracerProps
	extends Partial<WebGPUPathTracerImpl>,
	WebGPUPathTracerEventMapForR3f {
	enabled?: boolean;
	renderPriority?: number;
	children?: ReactNode;
}

export declare const WebGPUPathTracer: ForwardRefExoticComponent<
	WebGPUPathTracerProps & RefAttributes<WebGPUPathTracerImpl>
>;
