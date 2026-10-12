import { Camera, Scene, Texture, ExternalTexture } from 'three';
import { WebGPURenderer } from 'three/webgpu';

// three.js type augmentation

declare module 'three' {

	export interface Material {

		matte?: boolean;
		castShadow?: boolean;

	}

	export interface Object3D {

		visibleToShadowRays?: boolean;

	}

	export interface Light {

		visibleToCameraRays?: boolean;

	}

	export interface SpotLight {

		radius?: number;
		iesMap?: Texture | null;

	}

	export interface RectAreaLight {

		isCircular?: boolean;

	}

}

// constants

export type RandomStrategy = object;

export const RANDOM_PCG: RandomStrategy;
export const RANDOM_SOBOL: RandomStrategy;
export const RANDOM_BLUE_DITHER: RandomStrategy;

export const TRANSMISSIVE_BACKGROUND_ENVIRONMENT: 0;
export const TRANSMISSIVE_BACKGROUND_OVERLAY: 1;
export const TRANSMISSIVE_BACKGROUND_TRANSPARENT: 2;

export type TransmissiveBackgroundMode =
	typeof TRANSMISSIVE_BACKGROUND_ENVIRONMENT |
	typeof TRANSMISSIVE_BACKGROUND_OVERLAY |
	typeof TRANSMISSIVE_BACKGROUND_TRANSPARENT;

// environment

export class BlurredEnvMapGenerator {

	constructor( renderer: WebGPURenderer );

	generate( texture: Texture, blur?: number, width?: number | null, height?: number | null ): Promise<Texture>;
	dispose(): void;

}

// upscaler

export interface FSRUpscalerOptions {

	Upscaler: Function;
	sharpness?: number;

}

export class FSRUpscaler {

	constructor( options: FSRUpscalerOptions );

	Upscaler: Function;
	sharpness: number;

	init( renderer: WebGPURenderer ): void;
	upscale( source: Texture, camera: Camera ): Texture;
	dispose(): void;

}

// denoiser

export interface OIDNDenoiserOptions {

	initUNetFromURL: Function;
	auxWeightsUrl: string;
	colorWeightsUrl?: string;
	useAuxiliaryBuffers?: boolean;
	maxTileSize?: number | null;
	dynamicTile?: boolean | object | null;

}

export class OIDNDenoiser {

	constructor( options: OIDNDenoiserOptions );

	initUNetFromURL: Function;
	auxWeightsUrl: string;
	colorWeightsUrl: string | undefined;
	useAuxiliaryBuffers: boolean;
	maxTileSize: number | null;
	dynamicTile: boolean | object | null;

	readonly texture: ExternalTexture | null;
	readonly complete: boolean;
	readonly running: boolean;
	readonly error: Error | null;

	init( renderer: WebGPURenderer ): void;
	setScene( scene: Scene, camera: Camera ): void;
	update( target: Texture ): Texture | null;
	denoise( color: Texture, albedo?: Texture | null, normal?: Texture | null ): Promise<void>;
	reset(): void;
	dispose(): void;

}

// path tracer

export interface SampleCounts {

	min: number;
	max: number;
	avg: number;
	samplesPerSecond: number;

}

export interface AtlasTexture {

	readonly texture: Texture;
	readonly width: number;
	readonly height: number;
	readonly pageCount: number;

}

export interface DebugBoundsOptions {

	displayTLAS?: boolean;
	displayBLAS?: boolean;
	stopAtSurface?: boolean;
	saturationCount?: number;

}

export class WebGPUPathTracer {

	constructor( renderer: WebGPURenderer );

	maxBounces: number;
	frameBudget: number;
	maxTransparentBounces: number;
	maxSamples: number;
	transmissiveBackground: TransmissiveBackgroundMode;
	filterGlossyFactor: number;
	multipleImportanceSampling: boolean;
	clampDirect: number;
	clampIndirect: number;

	minSamples: number;
	renderDelay: number;
	fadeDuration: number;
	dynamicLowRes: boolean;
	lowResScale: number;
	renderScale: number;
	synchronizeRenderSize: boolean;
	generateMissingAttributes: boolean;
	commonAttributes: Array<string>;
	stableNoise: boolean;
	pause: boolean;

	readonly target: Texture | null;
	readonly fadeState: number;
	readonly lowResTarget: Texture;
	readonly lowResMode: boolean;
	readonly textureAtlas: AtlasTexture;

	getSampleCountsAsync(): Promise<SampleCounts>;
	setMultipleImportanceSampling( value: boolean ): void;
	setDenoiser( denoiser: OIDNDenoiser | null ): void;
	setUpscaler( upscaler: FSRUpscaler | null ): void;

	setScene( scene: Scene, camera: Camera ): void;
	setRandom( random: RandomStrategy ): void;
	setCamera( camera: Camera ): void;
	setSize( x: number, y: number ): void;

	updateMaterials(): void;
	updateTransforms(): void;
	updateCamera(): void;
	updateEnvironment(): void;
	updateLights(): void;

	reset(): void;
	renderSample(): void;
	renderDebugBounds( options?: DebugBoundsOptions ): void;
	renderTextureAtlas( layer?: number ): void;
	renderSampleDensity(): void;
	getRenderTime(): number;
	dispose(): void;

}
