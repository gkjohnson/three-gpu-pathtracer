import { wgsl } from 'three/tsl';
import { rayStruct } from 'three-mesh-bvh/webgpu';

export const constants = wgsl( /* wgsl */ `

		const PI: f32 = 3.141592653589793;

		const XYZ_TO_REC709 = mat3x3f(
			3.2404542, -0.9692660,  0.0556434,
			-1.5371385,  1.8760108, -0.2040259,
			-0.4985314,  0.0415560,  1.0572252
		);

		// TODO: expose modification of this value
		const filterGlossyFactor: f32 = 0.5;

		const EPSILON: f32 = 1e-5;

` );

export const scatterRecordStruct = wgsl( /* wgsl */ `

	struct ScatterRecord {
		color: vec3f,
		specularPdf: f32,
		direction: vec3f,
		pdf: f32,
	};

` );

export const materialStruct = wgsl( /* wgsl */`

	struct Material {
		// offset 0
		color: vec3f,
		map: i32,

		// offset 4 floats
		metalness: f32,
		metalnessMap: i32,

		roughness: f32,
		roughnessMap: i32,

		// offset 8 floats
		ior: f32,
		transmission: f32,
		transmissionMap: i32,

		emissiveIntensity: f32,
		// offset 12 floats
		emissive: vec3f,
		emissiveMap: i32,

		// offset 16 floats
		normalMap: i32,
		normalScale: vec2f,

		// offset 20 floats
		clearcoat: f32,
		clearcoatMap: i32,
		clearcoatNormalMap: i32,
		// offset 24 floats
		clearcoatNormalScale: vec2f,
		clearcoatRoughness: f32,
		clearcoatRoughnessMap: i32,

		// offset 28 floats
		iridescenceMap: i32,
		iridescenceThicknessMap: i32,
		iridescence: f32,
		iridescenceIor: f32,
		// offset 32 floats
		iridescenceThicknessMinimum: f32,
		iridescenceThicknessMaximum: f32,

		// offset 36 floats
		specularColor: vec3f,
		specularColorMap: i32,

		// offset 40 floats
		specularIntensity: f32,
		specualrIntensityMap: i32,
		thinFilm: i32, // actually a boolean

		// offset 44 floats
		attenuationColor: vec3f,
		attenuationDistance: f32,

		// offset 48 floats
		alphaMap: i32,

		castShadow: i32, // actually a boolean
		opacity: f32,
		alphaTest: f32,

		// offset 52 floats
		side: f32,
		matte: i32, // actually a boolean

		sheen: f32,
		// offset 56 floats
		sheenColor: vec3f,
		sheenColorMap: i32,
		// offset 60 floats
		sheenRoughness: f32,
		sheenRoughnessMap: i32,

		// All those are booleans
		vertexColors: i32,
		flatShading: i32,
		// offset 64 floats
		transparent: i32,
		fogVolume: i32,

		// offset 68 floats
		mapTransform: mat3x3f,
		// offset 80 floats
		metalnessMapTransform: mat3x3f,
		// offset 92 floats
		roughnessMapTransform: mat3x3f,
		// offset 104 floats
		transmissionMapTransform: mat3x3f,
		// offset 116 floats
		emissiveMapTransform: mat3x3f,
		// offset 128 floats
		normalMapTransform: mat3x3f,
		// offset 140 floats
		clearcoatMapTransform: mat3x3f,
		// offset 152 floats
		clearcoatNormalMapTransform: mat3x3f,
		// offset 164 floats
		clearcoatRoughnessMapTransform: mat3x3f,
		// offset 186 floats
		sheenColorMapTransform: mat3x3f,
		// offset 198 floats
		sheenRoughnessMapTransform: mat3x3f,
		// offset 210 floats
		iridescenceMapTransform: mat3x3f,
		// offset 222 floats
		iridescenceThicknessMapTransform: mat3x3f,
		// offset 234 floats
		specularColorMapTransform: mat3x3f,
		// offset 246 floats
		specularIntensityMapTransform: mat3x3f,
		// offset 258 floats
		alphaMapTransform: mat3x3f,
		// total size = 270
	};

` );

export const surfaceRecordStruct = wgsl( /* wgsl */`

	struct SurfaceRecord {
		// surface type
		volumeParticle: bool,

		// geometry
		faceNormal: vec3f,
		frontFace: bool,
		normal: vec3f,
		normalBasis: mat3x3f,
		normalInvBasis: mat3x3f,

		// cached properties
		eta: f32,
		f0: f32,

		// material
		roughness: f32,
		filteredRoughness: f32,
		metalness: f32,
		color: vec3f,
		emission: vec3f,

		// transmission
		ior: f32,
		transmission: f32,
		thinFilm: bool,
		attenuationColor: vec3f,
		attenuationDistance:  f32,

		// clearcoat
		clearcoatNormal: vec3f,
		clearcoatBasis: mat3x3f,
		clearcoatInvBasis: mat3x3f,
		clearcoat: f32,
		clearcoatRoughness: f32,
		filteredClearcoatRoughness: f32,

		// sheen
		sheen: f32,
		sheenColor: vec3f,
		sheenRoughness: f32,

		// iridescence
		iridescence: f32,
		iridescenceIor: f32,
		iridescenceThickness: f32,

		// specular
		specularColor: vec3f,
		specularIntensity: f32,
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

export const lobeWeightsStruct = wgsl( /* wgsl */ `

	struct LobeWeights {
		diffuse: f32,
		specular: f32,
		transmission: f32,
		clearcoat: f32,
	};

` );
