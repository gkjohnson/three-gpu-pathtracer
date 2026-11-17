import type { WebGPUPathTracer as WebGPUPathTracerImpl, WebGPUPathTracerEventMap } from '../../webgpu/index.js';
import type {
	ReactNode,
	Context,
	ForwardRefExoticComponent,
	RefAttributes,
	JSX,
} from 'react';

export declare const WebGPUPathTracerContext: Context<WebGPUPathTracerImpl | null>;
export declare const DenoiserContext: Context<any>;
export declare const UpscalerContext: Context<any>;

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

interface DenoiserProps<
	Type extends new ( ...args: any[] ) => any,
	Params extends any[] = ConstructorParameters<Type>,
> {
	denoiser: Type;
	args?: Params | Params[ 0 ];
	children?: ReactNode;
	[key: string]: any;
}

export declare const Denoiser: <
	Type extends new ( ...args: any[] ) => any,
>(
	props: DenoiserProps<Type> & RefAttributes<InstanceType<Type>>,
) => JSX.Element;

interface UpscalerProps<
	Type extends new ( ...args: any[] ) => any,
	Params extends any[] = ConstructorParameters<Type>,
> {
	upscaler: Type;
	args?: Params | Params[ 0 ];
	children?: ReactNode;
	[key: string]: any;
}

export declare const Upscaler: <
	Type extends new ( ...args: any[] ) => any,
>(
	props: UpscalerProps<Type> & RefAttributes<InstanceType<Type>>,
) => JSX.Element;
