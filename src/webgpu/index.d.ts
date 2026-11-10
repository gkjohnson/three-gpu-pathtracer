import { Camera, Color, EventDispatcher, Mesh, Object3D, Scene, Texture, ExternalTexture } from 'three';
import { StorageArrayTexture, StorageTexture, WebGPURenderer } from 'three/webgpu';
import { BVHWorker } from '../index.js';

// three.js type augmentation

declare module 'three' {

	export interface Material {

		matte?: boolean;
		castShadow?: boolean;

	}

	// volume scattering from "KHR_materials_scatter"
	export interface MeshPhysicalMaterial {

		scatterStrength?: number;
		multiscatterColor?: Color;
		scatterAnisotropy?: number;

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
	onBeforeDenoise?: OIDNBeforeDenoiseCallback | null;

}

export interface OIDNDenoiseImages {

	color?: Texture;
	albedo?: Texture | null;
	normal?: Texture | null;

}

export type OIDNBeforeDenoiseCallback = ( color: Texture, albedo: Texture | null, normal: Texture | null ) => OIDNDenoiseImages;

export interface OIDNDenoiserEventMap {

	'error': { error: Error };
	'progress': { progress: number };

}

export class OIDNDenoiser extends EventDispatcher<OIDNDenoiserEventMap> {

	constructor( options: OIDNDenoiserOptions );

	initUNetFromURL: Function;
	auxWeightsUrl: string;
	colorWeightsUrl: string | undefined;
	useAuxiliaryBuffers: boolean;
	maxTileSize: number | null;
	dynamicTile: boolean | object | null;
	onBeforeDenoise: OIDNBeforeDenoiseCallback | null;

	readonly texture: ExternalTexture | null;
	readonly complete: boolean;
	readonly running: boolean;

	init( renderer: WebGPURenderer ): void;
	update( target: Texture, aux?: StorageArrayTexture | null ): Texture | null;
	denoise( color: Texture, albedo?: Texture | null, normal?: Texture | null ): Promise<void>;
	reset(): void;
	dispose(): void;

}

// shading model

export class ShadingModel {

	structs: object;
	storage: object;
	fns: object;
	textures: Array<Texture>;

	init( renderer: WebGPURenderer ): void;
	updateFunctions(): void;
	getTextureDescriptor( material: object, key: string ): number;
	getField( material: object, key: string, def: any ): any;
	writeTextureMatrixToArray( material: object, textureKey: string, array: Float32Array, offset: number ): number;
	writeMaterialsBuffer( materials: Array<object> ): { materialData: Int32Array };
	getLightEmission( material: object, target: Color ): boolean;
	dispose(): void;

}

export class GLTFShadingModel extends ShadingModel {

	constructor( options?: object );

}

// baking

export interface AOMapShadingModelOptions {

	radius?: number;
	falloff?: boolean;

}

export class AOMapShadingModel extends ShadingModel {

	constructor( options?: AOMapShadingModelOptions );

	radius: { value: number };
	falloff: { value: number };

}

export class LightmapShadingModel extends GLTFShadingModel {}

export class UVUnwrapper {

	resolution: number;
	padding: number;
	useInputUVs: boolean;

	generate( root: Object3D ): Promise<void>;

}

export class UVMapCamera extends Camera {

	constructor( root: Object3D );

	root: Object3D;
	readonly idTexture: { readonly texture: Texture };

	dispose(): void;

}

export class AOMapCamera extends UVMapCamera {}

export interface LightmapCameraOptions {

	originOffset?: number;

}

export class LightmapCamera extends UVMapCamera {

	constructor( root: Object3D, options?: LightmapCameraOptions );

	originOffset: { value: number };

}

export class GutterFiller {

	constructor( renderer: WebGPURenderer, size: number );

	readonly size: number;

	createTarget(): StorageTexture;
	fill( map: Texture, ids: Texture, target?: StorageTexture, passes?: number ): StorageTexture;
	dispose(): void;

}

export interface SeamStitcherOptions {

	iterations?: number;
	normalThreshold?: number;
	samplesPerTexel?: number;
	coveredWeight?: number;
	paddingWeight?: number;
	seams?: object | null;

}

export class SeamStitcher {

	constructor( renderer: WebGPURenderer, root: Object3D, coverage: Texture, options?: SeamStitcherOptions );

	renderer: WebGPURenderer;
	iterations: number;
	readonly size: number;
	readonly seams: object;
	readonly texture: Texture;

	update( map: Texture ): Texture;
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

export interface WebGPUPathTracerEventMap {

	'complete': {};
	'progress': { stage: 'building' | 'compiling' | 'rendering' | 'denoising', progress: number | null, samples?: SampleCounts };

}

export class WebGPUPathTracer extends EventDispatcher<WebGPUPathTracerEventMap> {

	constructor( renderer: WebGPURenderer );

	maxBounces: number;
	frameBudget: number;
	adaptiveFrameBudget: boolean;
	targetFrameTime: number;
	maxTransparentBounces: number;
	maxSubsurfaceBounces: number;
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
	adaptiveDynamicRes: boolean;
	renderScale: number;
	synchronizeRenderSize: boolean;
	renderToCanvas: boolean;
	asyncCompile: boolean;
	generateMissingAttributes: boolean;
	commonAttributes: Array<string>;
	stableNoise: boolean;
	pause: boolean;

	readonly target: Texture | null;
	readonly frameTime: number;
	readonly complete: boolean;
	readonly fadeState: number;
	readonly lowResTarget: Texture;
	readonly lowResMode: boolean;
	readonly compiling: boolean;
	readonly textureAtlas: AtlasTexture;

	getSampleCountsAsync(): Promise<SampleCounts>;
	setShadingModel( shadingModel: ShadingModel ): void;
	getObjectInfo( object: Mesh, instanceId?: number, root?: number ): { slot: number, triangleOffset: number };
	setMultipleImportanceSampling( value: boolean ): void;
	setDenoiser( denoiser: OIDNDenoiser | null ): void;
	setUpscaler( upscaler: FSRUpscaler | null ): void;

	setScene( scene: Scene, camera: Camera ): void;
	setBVHWorker( WorkerConstructor: new () => BVHWorker & { dispose(): void } ): void;
	setSceneAsync( scene: Scene, camera: Camera ): Promise<void>;
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
	renderAuxBuffer( buffer?: 'albedo' | 'normal' ): void;
	getRenderTime(): number;
	dispose(): void;

}
