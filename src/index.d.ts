import {
	DataTexture,
	RectAreaLight,
	ShaderMaterial,
	SpotLight,
	Camera,
	PerspectiveCamera,
	MeshStandardMaterial,
	Light,
	Material,
	Object3D,
	Texture,
	Vector2,
	WebGLRenderer,
	WebGLRenderTarget,
	BufferGeometry,
	Color,
	ShaderMaterialParameters,
	MeshStandardMaterialParameters,
	Spherical,
	Scene,
	PMREMGenerator
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass';
import { MeshBVH, MeshBVHOptions } from 'three-mesh-bvh';

// three.js type augmentation

declare module 'three/src/materials/MeshStandardMaterial' {

	export interface MeshStandardMaterial {

		/**
		 * Whether to render the object as completely transparent against the rest of the environment
		 * so other objects can be composited later.
		 *
		 * Used by `WebGLPathTracer` from `three-gpu-pathtracer`.
		 */
		matte: boolean;
		/**
		 * Whether the object should cast a shadow.
		 *
		 * Used by `WebGLPathTracer` from `three-gpu-pathtracer`.
		 */
		castShadow: boolean;

	}

}

// core

export interface PathTracingSceneGeneratorResult {

	bvhChanged: boolean;
	bvh: MeshBVH;
	lights: Array<Light>;
	iesTextures: Array<DataTexture>;
	geometry: BufferGeometry;
	needsMaterialIndexUpdate: boolean;
	materials: Array<Material>;
	textures: Array<Texture>;
	objects: Array<Object3D>;

}

export interface BVHWorker {

	generate( geometry : BufferGeometry, options?: MeshBVHOptions ) : Promise<MeshBVH>

}

/**
 * @deprecated `PathTracingSceneGenerator` has been deprecated and will be removed in a future release.
 * Use `WebGLPathTracer` instead, as it handles scene generation internally.
 */
export class PathTracingSceneGenerator {

	constructor( objects?: Object3D | Array<Object3D> );

	readonly initialized: boolean;

	bvhOptions: MeshBVHOptions;
	attributes: Array<string>;
	generateBVH: boolean;

	bvh: MeshBVH | null;
	geometry: BufferGeometry;

	setObjects( objects: Object3D | Array<Object3D> ): void;
	setBVHWorker( bvhWorker: BVHWorker ): void;

	generateAsync( onProgress?: ( progress: number ) => void ): Promise<PathTracingSceneGeneratorResult>;
	generate( onProgress?: ( progress: number ) => void ): PathTracingSceneGeneratorResult;

}

/**
 * @deprecated `DynamicPathTracingSceneGenerator` has been deprecated and will be removed in a future release.
 * Use `WebGLPathTracer` instead, as it handles scene generation internally.
 */
export class DynamicPathTracingSceneGenerator extends PathTracingSceneGenerator {}

/**
 * @deprecated `PathTracingSceneWorker` has been deprecated and will be removed in a future release.
 * Use `WebGLPathTracer` instead, as it handles scene generation internally.
 */
export class PathTracingSceneWorker extends PathTracingSceneGenerator {}

export class WebGLPathTracer {

	constructor( renderer: WebGLRenderer );

	readonly samples: number;
	readonly target: WebGLRenderTarget;
	readonly tiles: Vector2;
	readonly camera: Camera | null;
	readonly scene: Scene | null;

	multipleImportanceSampling: boolean;
	bounces: number;
	transmissiveBounces: number;
	filterGlossyFactor: number;
	renderDelay: number;
	minSamples: number;
	fadeDuration: number;
	enablePathTracing: boolean;
	pausePathTracing: boolean;
	dynamicLowRes: boolean;
	lowResScale: number;
	renderScale: number;
	synchronizeRenderSize: boolean;
	rasterizeScene: boolean;
	renderToCanvas: boolean;
	textureSize: Vector2;

	rasterizeSceneCallback: ( scene: Scene, camera: Camera ) => void;
	renderToCanvasCallback: ( target: WebGLRenderTarget, renderer: WebGLRenderer, quad: FullScreenQuad ) => void;

	setBVHWorker( bvhWorker: BVHWorker ): void;
	setScene(
		scene: Scene,
		camera: Camera,
		options?: { onProgress?: ( progress: number ) => void }
	): void;
	setSceneAsync(
		scene: Scene,
		camera: Camera,
		options?: { onProgress?: ( progress: number ) => void }
	): Promise<void>;
	setCamera( camera: Camera ): void;

	updateCamera(): void;
	updateMaterials(): void;
	updateLights(): void;
	updateEnvironment(): void;
	renderSample(): void;
	reset(): void;
	dispose(): void;

}

// objects

export class PhysicalCamera extends PerspectiveCamera {

	focusDistance: number;
	fStop: number;
	bokehSize: number;
	apertureBlades: number;
	apertureRotation: number;
	anamorphicRatio: number;

}

export class EquirectCamera extends Camera {

	readonly isEquirectCamera: true;

}

export class PhysicalSpotLight extends SpotLight {

	radius: number;
	iesTexture: DataTexture | null;

}

export class ShapedAreaLight extends RectAreaLight {

	isCircular: boolean;

}

// textures

export class ProceduralEquirectTexture extends DataTexture {

	constructor( width?: number, height?: number );

	generationCallback( polar: Spherical, uv: Vector2, coord: Vector2, color: Color ): void;

	update(): void;

}

export class GradientEquirectTexture extends ProceduralEquirectTexture {

	constructor( resolution?: number );

	exponent: number;
	topColor: Color;
	bottomColor: Color;

}

// utils

export class BlurredEnvMapGenerator {

	constructor( renderer: WebGLRenderer );

	renderer: WebGLRenderer;
	pmremGenerator: PMREMGenerator;
	copyQuad: FullScreenQuad;
	renderTarget: WebGLRenderTarget;

	generate( texture: Texture, blur: number ): DataTexture;
	dispose(): void;

}

// materials

declare class MaterialBase extends ShaderMaterial {

	setDefine( name: string, value: any ): boolean;

}

export interface DenoiseMaterialParameters extends ShaderMaterialParameters {

	sigma?: number;
	kSigma?: number;
	threshold?: number;
	map?: Texture;

}

export class DenoiseMaterial extends MaterialBase {

	constructor( parameters?: DenoiseMaterialParameters );

	sigma: number;
	kSigma: number;
	threshold: number;
	map: Texture | null;

}

export interface FogVolumeMaterialParameters extends MeshStandardMaterialParameters {

	density?: number;

}

export class FogVolumeMaterial extends MeshStandardMaterial {

	constructor( parameters?: FogVolumeMaterialParameters );

	readonly isFogVolumeMaterial: true;

	density: number;

}
