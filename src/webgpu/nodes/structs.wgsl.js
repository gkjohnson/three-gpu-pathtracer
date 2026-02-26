import { wgsl } from 'three/tsl';
import { StructTypeNode } from 'three/webgpu';
import { rayStruct } from 'three-mesh-bvh/webgpu';

export const constants = wgsl( /* wgsl */ `
	const PI: f32 = 3.141592653589793;
` );

export const scatterRecordStruct = wgsl( /* wgsl */ `
	struct ScatterRecord {
		direction: vec3f,
		pdf: f32, // Actually just a probability
		value: f32,
	};
` );

export const materialStruct = new StructTypeNode( {
	// offset 0
	color: 'vec3',
	map: 'int',

	// offset 4 floats
	metalness: 'float',
	metalnessMap: 'int',

	roughness: 'float',
	roughnessMap: 'int',

	// offset 8 floats
	ior: 'float',
	transmission: 'float',
	transmissionMap: 'int',

	emissiveIntensity: 'float',
	// offset 12 floats
	emissive: 'vec3',
	emissiveMap: 'int',

	// offset 16 floats
	normalMap: 'int',
	normalScale: 'vec2',

	// offset 20 floats
	clearcoat: 'float',
	clearcoatMap: 'int',
	clearcoatNormalMap: 'int',
	// offset 24 floats
	clearcoatNormalScale: 'vec2',
	clearcoatRoughness: 'float',
	clearcoatRoughnessMap: 'int',

	// offset 28 floats
	iridescenceMap: 'int',
	iridescenceThicknessMap: 'int',
	iridescence: 'float',
	iridescenceIor: 'float',
	// offset 32 floats
	iridescenceThicknessMinimum: 'float',
	iridescenceThicknessMaximum: 'float',

	// offset 36 floats
	specularColor: 'vec3',
	specularColorMap: 'int',

	// offset 40 floats
	specularIntensity: 'float',
	specularIntensityMap: 'int',
	thinFilm: 'int', // actually a boolean

	// offset 44 floats
	attenuationColor: 'vec3',
	attenuationDistance: 'float',

	// offset 48 floats
	alphaMap: 'int',

	castShadow: 'int', // actually a boolean
	opacity: 'float',
	alphaTest: 'float',

	// offset 52 floats
	side: 'float',
	matte: 'int', // actually a boolean

	sheen: 'float',
	// offset 56 floats
	sheenColor: 'vec3',
	sheenColorMap: 'int',
	// offset 60 floats
	sheenRoughness: 'float',
	sheenRoughnessMap: 'int',

	// All those are booleans
	vertexColors: 'int',
	flatShading: 'int',
	// offset 64 floats
	transparent: 'int',
	fogVolume: 'int',

	// offset 68 floats
	mapTransform: 'mat3',
	// offset 80 floats
	metalnessMapTransform: 'mat3',
	// offset 92 floats
	roughnessMapTransform: 'mat3',
	// offset 104 floats
	transmissionMapTransform: 'mat3',
	// offset 116 floats
	emissiveMapTransform: 'mat3',
	// offset 128 floats
	normalMapTransform: 'mat3',
	// offset 140 floats
	clearcoatMapTransform: 'mat3',
	// offset 152 floats
	clearcoatNormalMapTransform: 'mat3',
	// offset 164 floats
	clearcoatRoughnessMapTransform: 'mat3',
	// offset 186 floats
	sheenColorMapTransform: 'mat3',
	// offset 198 floats
	sheenRoughnessMapTransform: 'mat3',
	// offset 210 floats
	iridescenceMapTransform: 'mat3',
	// offset 222 floats
	iridescenceThicknessMapTransform: 'mat3',
	// offset 234 floats
	specularColorMapTransform: 'mat3',
	// offset 246 floats
	specularIntensityMapTransform: 'mat3',
	// offset 258 floats
	alphaMapTransform: 'mat3',
	// total size = 270
}, 'Material' );

export const surfaceRecordStruct = wgsl( /* wgsl */`
	struct SurfaceRecord {
		normal: vec3f,
		albedo: vec3f,

		roughness: f32,
		metalness: f32,
	};
` );

// TODO: write a proposal for a storage-backed structs and arrays in structs for three.js
//
// const hitResultQueueStruct = wgsl( /* wgsl */ `
// 	struct HitResultQueue {
// 		currentSize: atomic<u32>,
// 		queue: array<HitResultQueueElement>,
// 	};
// `, [ hitResultQueueElementStruct ] );

export const rayQueueElementStruct = wgsl( /* wgsl */ `

	struct RayQueueElement {
		ray: Ray,
		throughputColor: vec3f,
		currentBounce: u32,
		pixel: vec2u,
	};

`, [ rayStruct ] );

export const hitResultQueueElementStruct = wgsl( /* wgsl */`
	struct HitResultQueueElement {
		normal: vec3f,
		pixel_x: u32,
		position: vec3f,
		pixel_y: u32,
		view: vec3f,
		currentBounce: u32,
		throughputColor: vec3f,
		vertexIndex: u32,
	};
` );

export const environmentInfoStruct = wgsl( /* wgsl */ `

	struct EnvironmentInfo {

		rotation: mat3x3f,
		intensity: f32,
		blur: f32,

	};

` );
