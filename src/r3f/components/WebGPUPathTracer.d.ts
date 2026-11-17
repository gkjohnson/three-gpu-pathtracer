import type { WebGPUPathTracer as WebGPUPathTracerImpl, WebGPUPathTracerEventMap } from '../../webgpu/index.js';
import type {
	ReactNode,
	Context,
	ForwardRefExoticComponent,
	RefAttributes,
} from 'react';

export declare const WebGPUPathTracerContext: Context<WebGPUPathTracerImpl | null>;

export declare function usePathTracer(): WebGPUPathTracerImpl | null;

// the properties of the path tracer that can be assigned
type WebGPUPathTracerSettableKeys =
	| 'maxBounces'
	| 'frameBudget'
	| 'adaptiveFrameBudget'
	| 'targetFrameTime'
	| 'maxTransparentBounces'
	| 'maxSubsurfaceBounces'
	| 'maxFogBounces'
	| 'maxSamples'
	| 'transmissiveBackground'
	| 'filterGlossyFactor'
	| 'multipleImportanceSampling'
	| 'clampDirect'
	| 'clampIndirect'
	| 'minSamples'
	| 'renderDelay'
	| 'fadeDuration'
	| 'dynamicLowRes'
	| 'renderScale'
	| 'interpolateDisplay'
	| 'synchronizeRenderSize'
	| 'renderToCanvas'
	| 'asyncCompile'
	| 'generateMissingAttributes'
	| 'commonAttributes'
	| 'stableNoise'
	| 'pause';

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
	extends Partial<Pick<WebGPUPathTracerImpl, WebGPUPathTracerSettableKeys>>,
	WebGPUPathTracerEventMapForR3f {
	enabled?: boolean;
	renderPriority?: number;
	children?: ReactNode;
}

export declare const WebGPUPathTracer: ForwardRefExoticComponent<
	WebGPUPathTracerProps & RefAttributes<WebGPUPathTracerImpl>
>;
