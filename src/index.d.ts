import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass';
import {
	DataTexture,
	RectAreaLight,
	ShaderMaterial,
	SpotLight,
	WebGLArrayRenderTarget,
	Camera,
	PerspectiveCamera,
	Loader,
	MeshStandardMaterial,
	Light,
	Material,
	Object3D,
	Texture,
	Vector2,
	WebGLRenderer,
	WebGLRenderTarget,
	BufferGeometry,
	Matrix4,
	Color,
	ShaderMaterialParameters,
	Vector4,
	MeshStandardMaterialParameters,
	Spherical,
	Scene,
	RenderTargetOptions,
	PMREMGenerator,
	DataArrayTexture,
	BufferAttribute,
} from 'three';
import {
	MeshBVH,
	MeshBVHOptions,
	MeshBVHUniformStruct,
	UIntVertexAttributeTexture,
} from 'three-mesh-bvh';

//#region core

export class PathTracingRenderer<TMaterial extends ShaderMaterial> {

	constructor( renderer: WebGLRenderer );

	readonly samples: number;
	readonly target: WebGLRenderTarget;

	material: TMaterial | null;
	alpha: boolean;
	camera: Camera | null;
	tiles: Vector2;
	stableNoise: boolean;
	stableTiles: boolean;

	setCamera( camera: Camera ): void;
	setSize( width: number, height: number ): void;
	getSize( target: Vector2 ): void;

	dispose(): void;
	reset(): void;
	update(): void;

}

export class QuiltPathTracingRenderer<TMaterial extends ShaderMaterial> extends PathTracingRenderer<TMaterial> {

	quiltDimensions: Vector2;
	viewCount: number;
	viewCone: number;
	viewFoV: number;
	displayDistance: number;
	displayAspect: number;

	setFromDisplayView( viewerDistance: number, displayWidth: number, displayHeight: number ): void;

}

export const NO_CHANGE: 0;
export const GEOMETRY_ADJUSTED: 1;
export const GEOMETRY_REBUILT: 2;
export type ChangeType = typeof NO_CHANGE | typeof GEOMETRY_ADJUSTED | typeof GEOMETRY_REBUILT;

export interface StaticGeometryGeneratorResult {

	changeType: ChangeType
	materials: Array<Material>;
	geometry: BufferGeometry;

}

declare class StaticGeometryGenerator {

	constructor( objects?: Object3D | Array<Object3D> );

	objects: Array<Object3D> | null;
	useGroups: boolean;
	applyWorldTransforms: boolean;
	generateMissingAttributes: boolean;
	overwriteIndex:boolean;
	attributes: Array<string>;

	setObjects( objects: Object3D | Array<Object3D> ): void;

	generate( targetGeometry?: BufferGeometry ): StaticGeometryGeneratorResult;

}

export interface PathTracingSceneGeneratorResult {

	bvhChanged: boolean;
	bvh: MeshBVH;
	lights: Array<Light>;
	iesTextures: Array<DataTexture>;
	geometry: BufferGeometry;
	materials: Array<Material>;
	textures: Array<Texture>;
	objects: Array<Object3D>;

}

export class PathTracingSceneGenerator {

	constructor( objects?: Object3D | Array<Object3D> );

	readonly initialized: boolean;

	bvhOptions: MeshBVHOptions;
	attributes: Array<string>;
	generateBVH: boolean;

	bvh: MeshBVH | null;
	geometry: BufferGeometry;
	staticGeometryGenerator: StaticGeometryGenerator;

	setObjects( objects: Object3D | Array<Object3D> ): void;
	// TODO: The worker and its type are not exported from `three-mesh-bvh`
	setBVHWorker( bvhWorker: any ): void;

	generateAsync( onProgress?: ( progress: number ) => void ): Promise<PathTracingSceneGeneratorResult>;
	generate( onProgress?: ( progress: number ) => void ): PathTracingSceneGeneratorResult;

}

/**
 * @deprecated use `PathTracingSceneGenerator` instead
 */
export class DynamicPathTracingSceneGenerator extends PathTracingSceneGenerator {}

/**
 * @deprecated use `PathTracingSceneGenerator` instead
 */
export class PathTracingSceneWorker extends PathTracingSceneGenerator {}

export class MaterialReducer {

	ignoreKeys: Set<string>;
	shareTextures: boolean;

	textures: Array<Texture>;
	materials: Array<Material>;

	areEqual( a: unknown, b: unknown ): boolean;
	process( object: Object3D ): { replaced: number; retained: number; };

}

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

	// TODO: The worker and its type are not exported from `three-mesh-bvh`
	setBVHWorker( bvhWorker: any ): void;
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
	// TODO: Add additional material properties somewhere (see docs)
	updateMaterials(): void;
	updateLights(): void;
	updateEnvironment(): void;
	renderSample(): void;
	reset(): void;
	dispose(): void;

}

//#endregion

//#region objects

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

//#endregion

//#region textures

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

//#endregion

//#region uniforms

declare class FloatAttributeTextureArray extends DataArrayTexture {

	updateAttribute( index: number, attribute: BufferAttribute ): void;
	setAttributes( attributes: Array<BufferAttribute> ): void;

}

declare class AttributesTextureArray extends FloatAttributeTextureArray {

	updateNormalAttribute( attr: BufferAttribute ): void;
	updateTangentAttribute( attr: BufferAttribute ): void;
	updateUvAttribute( attr: BufferAttribute ): void;
	updateColorAttribute( attr: BufferAttribute ): void;
	updateFrom(
		normal: BufferAttribute,
		tangent: BufferAttribute,
		uv: BufferAttribute,
		color: BufferAttribute,
	): void;

}

declare class MaterialFeatures {

	isUsed( feature: string ): boolean;
	setUsed( feature: string, used?: boolean ): void;
	reset(): void;

}

export class MaterialsTexture extends DataTexture {

	features: MaterialFeatures;

	updateFrom( materials: Array<Material>, textures: Array<Texture> ): boolean;

}

export class RenderTarget2DArray extends WebGLArrayRenderTarget {

	constructor( width?: number, height?: number, options?: RenderTargetOptions );

	setTextures( renderer: WebGLRenderer, textures: Array<Texture>, width?: number, height?: number ): boolean;

}

export class EquirectHdrInfoUniform {

	map: Texture;
	marginalWeights: DataTexture;
	conditionalWeights: DataTexture;
	totalSum: number;

	updateFrom( hdr: Texture ): void;
	dispose(): void;

}

export class PhysicalCameraUniform {

	bokehSize: number;
	apertureBlades: number;
	apertureRotation: number;
	focusDistance: number;
	anamorphicRatio: number;

	updateFrom( camera: Camera ): void;

}

export class LightsInfoUniformStruct {

	tex: DataTexture;
	count: number;
	hash: number;

	updateFrom( lights: Array<Light>, iesTextures?: Array<DataTexture> ): void;

}

//#endregion

//#region utils

export class BlurredEnvMapGenerator {

	constructor( renderer: WebGLRenderer );

	renderer: WebGLRenderer;
	pmremGenerator: PMREMGenerator;
	copyQuad: FullScreenQuad;
	renderTarget: WebGLRenderTarget;

	generate( texture: Texture, blur: number ): DataTexture;
	dispose(): void;

}

export class IESLoader extends Loader {

	load(
		url: string,
		onLoad?: ( data: DataTexture ) => void,
		onProgress?: ( event: ProgressEvent ) => void,
		onError?: ( err: unknown ) => void,
	): DataTexture;
	parse( text: string ): DataTexture;

}

//#endregion

//#region materials

export class MaterialBase<TDefines extends Record<string, unknown> = Record<string, never>> extends ShaderMaterial {

	setDefine<K extends keyof TDefines>( name: K, value: TDefines[K] | null | undefined ): boolean;

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

export type GradientMapMaterialDefines = {

	FEATURE_BIN: 0 | 1;

}

export interface GradientMapMaterialParameters extends ShaderMaterialParameters {

	map?: Texture | null;
	minColor?: Color;
	minValue?: number;
	maxColor?: Color;
	maxValue?: number;
	field?: number;
	power?: number;

}

export class GradientMapMaterial extends MaterialBase<GradientMapMaterialDefines> {

	constructor( parameters?: GradientMapMaterialParameters );

	map: Texture | null;
	minColor: Color;
	minValue: number;
	maxColor: Color;
	maxValue: number;
	field: number;
	power: number;

}

export interface GraphMaterialParameters extends ShaderMaterialParameters {

	dim?: boolean;
	thickness?: number;
	graphCount?: number;
	graphDisplay?: Vector4;
	overlay?: boolean;
	xRange?: Vector2;
	yRange?: Vector2;
	colors?: Array<Color>;

}

export class GraphMaterial extends MaterialBase {

	constructor( parameters?: GraphMaterialParameters );

	dim: boolean;
	thickness: number;
	graphCount: number;
	graphDisplay: Vector4;
	overlay: boolean;
	xRange: Vector2;
	yRange: Vector2;
	colors: Array<Color>;
	graphFunctionSnippet: string;

}

export type PhysicalPathTracingMaterialDefines = {

	FEATURE_MIS: 0 | 1;
	FEATURE_RUSSIAN_ROULETTE: 0 | 1;
	RANDOM_TYPE: 0 | 1 | 2;

	FEATURE_DOF: 0 | 1,
	FEATURE_BACKGROUND_MAP: 0 | 1,
	FEATURE_FOG: 0 | 1,
	CAMERA_TYPE: 0 | 1 | 2,
	DEBUG_MODE: 0 | 1,

	ATTR_NORMAL: number,
	ATTR_TANGENT: number,
	ATTR_UV: number,
	ATTR_COLOR: number,

};

export interface PhysicalPathTracingMaterialParameters extends ShaderMaterialParameters {

	resolution?: Vector2;
	bounces?: number;
	transmissiveBounces?: number;
	filterGlossyFactor?: number;

	physicalCamera?: PhysicalCameraUniform;
	cameraWorldMatrix?: Matrix4;
	invProjectionMatrix?: Matrix4;

	bvh?: MeshBVHUniformStruct;
	attributesArray?: AttributesTextureArray;
	materialIndexAttribute?: UIntVertexAttributeTexture;
	materials?: MaterialsTexture;
	textures?: DataArrayTexture;

	// TODO: TypeScript doesn't allow overriding properties with different types
	lights?: LightsInfoUniformStruct;
	iesProfiles?: DataArrayTexture;
	environmentIntensity?: number;
	environmentRotation?: Matrix4;
	envMapInfo?: EquirectHdrInfoUniform;

	backgroundBlur?: number;
	backgroundMap?: Texture;
	backgroundAlpha?: number;
	backgroundIntensity?: number;
	backgroundRotation?: Matrix4;

	seed?: number;
	sobolTexture?: Texture;
	stratifiedTexture?: DataTexture;
	stratifiedOffsetTexture?: DataTexture;

}

export class PhysicalPathTracingMaterial extends MaterialBase<PhysicalPathTracingMaterialDefines> {

	constructor( parameters?: PhysicalPathTracingMaterialParameters );

	resolution: Vector2;
	bounces: number;
	transmissiveBounces: number;
	filterGlossyFactor: number;

	physicalCamera: PhysicalCameraUniform;
	cameraWorldMatrix: Matrix4;
	invProjectionMatrix: Matrix4;

	bvh: MeshBVHUniformStruct;
	attributesArray: AttributesTextureArray;
	materialIndexAttribute: UIntVertexAttributeTexture;
	materials: MaterialsTexture;
	textures: DataArrayTexture;

	// TODO: TypeScript doesn't allow overriding properties with different types
	lights: LightsInfoUniformStruct;
	iesProfiles: DataArrayTexture;
	environmentIntensity: number;
	environmentRotation: Matrix4;
	envMapInfo: EquirectHdrInfoUniform;

	backgroundBlur: number;
	backgroundMap: Texture;
	backgroundAlpha: number;
	backgroundIntensity: number;
	backgroundRotation: Matrix4;

	seed: number;
	sobolTexture: Texture;
	stratifiedTexture: DataTexture;
	stratifiedOffsetTexture: DataTexture;

}

export interface FogVolumeMaterialParameters extends MeshStandardMaterialParameters {

	density?: number;

}

export class FogVolumeMaterial extends MeshStandardMaterial {

	constructor( parameters?: FogVolumeMaterialParameters );

	readonly isFogVolumeMaterial: true;

	density: number;

}

//#endregion

//#region detectors

export class CompatibilityDetector {

	constructor( renderer: WebGLRenderer, material: Material );

	detect(): { detail: Record<string, unknown> | null; pass: boolean; message: string; };

}

//#endregion
