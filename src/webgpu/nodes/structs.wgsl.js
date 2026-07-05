import { wgsl } from 'three/tsl';
import { StructTypeNode } from 'three/webgpu';

// TODO: Move to node-based constants that are embedded with wgslTagFn
export const constants = wgsl( /* wgsl */ `

	const PI: f32 = 3.141592653589793;
	const EPSILON: f32 = 1e-5;
	const MIN_ROUGHNESS: f32 = 1e-3;

` );

export const scatterRecordStruct = new StructTypeNode( {
	color: 'vec3f',
	specularPdf: 'float',
	direction: 'vec3f',
	pdf: 'float',
}, 'ScatterRecord' );

// NOTE: all "*Map" fields are bit-packed integers of texture index & settings:
// bits 0-23: texture index
// bits 24-25: wrapS setting
// bits 26-27: wrapT setting
// bit 28: filter setting
// bits 29-30: unused
// bit 31: negative bit used for indicating unused texture
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
	// offset 66 floats
	anisotropy: 'float',
	anisotropyRotation: 'float',

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
	// offset 176 floats
	sheenColorMapTransform: 'mat3',
	// offset 188 floats
	sheenRoughnessMapTransform: 'mat3',
	// offset 200 floats
	iridescenceMapTransform: 'mat3',
	// offset 212 floats
	iridescenceThicknessMapTransform: 'mat3',
	// offset 224 floats
	specularColorMapTransform: 'mat3',
	// offset 236 floats
	specularIntensityMapTransform: 'mat3',
	// offset 248 floats
	alphaMapTransform: 'mat3',
	// total size = 260
}, 'Material' );

export const surfaceRecordStruct = new StructTypeNode( {
	// surface type
	volumeParticle: 'bool',

	// geometry
	faceNormal: 'vec3f',
	frontFace: 'bool',
	normal: 'vec3f',
	normalBasis: 'mat3x3f',
	normalInvBasis: 'mat3x3f',

	// cached properties
	eta: 'f32',
	f0: 'f32',

	// material
	roughness: 'f32',
	metalness: 'f32',
	anisotropy: 'f32',
	color: 'vec3f',
	emission: 'vec3f',

	// transmission
	ior: 'f32',
	transmission: 'f32',
	thinFilm: 'bool',
	attenuationColor: 'vec3f',
	attenuationDistance: ' f32',

	// clearcoat
	clearcoatNormal: 'vec3f',
	clearcoatBasis: 'mat3x3f',
	clearcoatInvBasis: 'mat3x3f',
	clearcoat: 'f32',
	clearcoatRoughness: 'f32',

	// sheen
	sheen: 'f32',
	sheenColor: 'vec3f',
	sheenRoughness: 'f32',

	// iridescence
	iridescence: 'f32',
	iridescenceIor: 'f32',
	iridescenceThickness: 'f32',

	// specular
	specularColor: 'vec3f',
	specularIntensity: 'f32',
}, 'SurfaceRecord' );

export const environmentInfoStruct = new StructTypeNode( {
	rotation: 'mat3x3f',
	intensity: 'float',
	blur: 'float',
}, 'EnvironmentInfo' );

export const lobeWeightsStruct = new StructTypeNode( {
	diffuse: 'float',
	specular: 'float',
	transmission: 'float',
	clearcoat: 'float',
}, 'LobeWeights' );

export const bxdfContextStruct = new StructTypeNode( {

	V: 'vec3f', // view dir
	L: 'vec3f', // light dir
	H: 'vec3f', // half dir

	NdotV: 'float',
	NdotL: 'float',
	NdotH: 'float',
	VdotH: 'float',

	VdotNc: 'float',
	LdotNc: 'float',
	HdotNc: 'float',

}, 'BxDFContext' );
