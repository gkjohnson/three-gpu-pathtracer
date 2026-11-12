import { StructTypeNode } from 'three/webgpu';
import { wgslTagFn, rayStruct, contextProxy } from 'three-mesh-bvh/webgpu';
import { LIGHT_FAR_DISTANCE } from './lights.wgsl.js';
import { DependentStructTypeNode } from './DependentStructTypeNode.js';

// Random walk subsurface scattering, following Cycles' subsurface_random_walk.h
// https://github.com/blender/cycles/blob/a456b761034dda42c32eef9f4aae0fa5a5c9f604/src/kernel/integrator/subsurface_random_walk.h

// the smallest attenuation color used to derive a medium's extinction, keeping the log finite
const MEDIUM_MIN_ATTENUATION = 1e-6;

// the throughput below which a walk stops, matching Cycles' VOLUME_THROUGHPUT_EPSILON
export const MEDIUM_THROUGHPUT_EPSILON = 1e-6;

// the largest phase anisotropy used, short of the +/- 1 delta phase function the scatter albedo
// inversion and the Henyey-Greenstein pdf divide by zero at
const MEDIUM_MAX_ANISOTROPY = 0.999;

// The volumes a path is inside of, by material index, as in Cycles' volume_stack.h. A slot without a volume holds
// MEDIUM_STACK_EMPTY
// TODO: separate objects with the same material share a slot, so overlapping or nested ones aren't tracked
// apart. This could be handled more robustly with a per object id, but is skipped for now
const MEDIUM_STACK_SIZE = 4;
const MEDIUM_STACK_EMPTY = 0xffffffff;
export const mediumStackStruct = new StructTypeNode( {
	ids: `array<u32, ${ MEDIUM_STACK_SIZE }>`,
}, 'MediumStack' );

// shadow rays at least this long go to distant lights, whose distance is the far distance
const MEDIUM_DISTANT_SHADOW_DISTANCE = 0.5 * LIGHT_FAR_DISTANCE;

// The medium a path is in: the combined media of its stack of fog and absorbing volumes, or the material of a
// subsurface walk, which isn't on the stack. "scatters" and "subsurface" are uints so the struct can be held in a
// storage buffer. A scatter event in fog is a path vertex, where a subsurface walk takes no light sample
const mediumMembers = {
	extinction: 'vec3f',
	scatters: 'uint',

	albedo: 'vec3f',
	anisotropy: 'float',

	subsurface: 'uint',
};

export const mediumStruct = new DependentStructTypeNode( {
	stack: mediumStackStruct.name,
	...mediumMembers,
}, 'Medium', [ mediumStackStruct ] );

// three.js can't size array or struct members, so the struct is sized with the stack as uints
const stackAsUints = {};
for ( let i = 0; i < MEDIUM_STACK_SIZE; i ++ ) {

	stackAsUints[ `stack${ i }` ] = 'uint';

}

mediumStruct.getLength = () => new StructTypeNode( { ...stackAsUints, ...mediumMembers } ).getLength();

// Returns the single scatter albedo of a volume from its perceived multi scatter albedo and phase anisotropy, using
// the inversion from "KHR_materials_scatter" (after Kulla and Conty 2017). A zero multi scatter albedo maps to zero
// https://github.com/KhronosGroup/glTF/pull/2579
const getSingleScatterAlbedoFn = wgslTagFn/* wgsl */`

	fn getSingleScatterAlbedo( multiscatterAlbedo: vec3f, anisotropy: f32 ) -> vec3f {

		let a = multiscatterAlbedo;
		let s = clamp( 4.09712 + 4.20863 * a - sqrt( 9.59217 + 41.6808 * a + 17.7126 * a * a ), vec3f( 0.0 ), vec3f( 1.0 ) );
		let s2 = select( s * s, vec3f( 1.0 ), a <= vec3f( 0.0 ) );
		return ( 1.0 - s2 ) / ( 1.0 - anisotropy * s2 );

	}

`;

const materialsStorage = contextProxy( 'shadingModel.storage.materials' );

// returns a material's extinction from its glTF attenuation, zero for one without a volume
export const getMaterialExtinctionFn = wgslTagFn/* wgsl */`

	fn getMaterialExtinction( attenuationColor: vec3f, attenuationDistance: f32 ) -> vec3f {

		return - log( max( attenuationColor, vec3f( ${ MEDIUM_MIN_ATTENUATION } ) ) ) / attenuationDistance;

	}

`;

// Adds the material's volume to an empty slot of the stack. A volume without extinction, one already on the stack,
// or one past a full stack is not added
export const addToMediumStackFn = wgslTagFn/* wgsl */`

	fn addToMediumStack( stack: ptr<function, ${ mediumStackStruct }>, materialIndex: u32 ) -> void {

		let material = ${ materialsStorage }[ materialIndex ];
		if ( all( ${ getMaterialExtinctionFn }( material.attenuationColor, material.attenuationDistance ) <= vec3f( 0.0 ) ) ) {

			return;

		}

		for ( var i = 0u; i < ${ MEDIUM_STACK_SIZE }u; i ++ ) {

			if ( stack.ids[ i ] == materialIndex ) {

				return;

			}

		}

		for ( var i = 0u; i < ${ MEDIUM_STACK_SIZE }u; i ++ ) {

			if ( stack.ids[ i ] == ${ MEDIUM_STACK_EMPTY }u ) {

				stack.ids[ i ] = materialIndex;
				return;

			}

		}

	}

`;

// Empties the slot holding the material's volume
export const removeFromMediumStackFn = wgslTagFn/* wgsl */`

	fn removeFromMediumStack( stack: ptr<function, ${ mediumStackStruct }>, materialIndex: u32 ) -> void {

		for ( var i = 0u; i < ${ MEDIUM_STACK_SIZE }u; i ++ ) {

			if ( stack.ids[ i ] == materialIndex ) {

				stack.ids[ i ] = ${ MEDIUM_STACK_EMPTY }u;

			}

		}

	}

`;

// Returns the stack of volumes containing the point, as in Cycles' integrator_volume_stack_init: a volume whose
// nearest hit along a ray from the point is a back face contains it. Assumes closed volumes with outward facing
// normals
export const getMediumStackAtPointFn = wgslTagFn/* wgsl */`

	fn getMediumStackAtPoint( point: vec3f ) -> ${ mediumStackStruct } {

		var ray: ${ rayStruct };
		ray.origin = point;
		ray.direction = vec3f( 0.0, 0.0, 1.0 );
		ray.maxDist = 0.0;

		var hits: ${ contextProxy( 'bvhData.fns.collectVolumeHits.outputType' ) };
		${ contextProxy( 'bvhData.fns.collectVolumeHits' ) }( ray, &hits );

		var stack: ${ mediumStackStruct };
		for ( var i = 0u; i < ${ MEDIUM_STACK_SIZE }u; i ++ ) {

			stack.ids[ i ] = ${ MEDIUM_STACK_EMPTY }u;

		}

		for ( var i = 0u; i < hits.count; i ++ ) {

			if ( hits.side[ i ] < 0.0 ) {

				${ addToMediumStackFn }( &stack, hits.ids[ i ] );

			}

		}

		return stack;

	}

`;

// Returns the combined medium of all the stack's volumes, as if inside them all at once: coefficients summed as
// in Cycles, with the anisotropy averaged by scattering. Only fog scatters, the other volumes only absorb
export const getCombinedMediumFn = wgslTagFn/* wgsl */`

	fn getCombinedMedium( stack: ${ mediumStackStruct } ) -> ${ mediumStruct } {

		var extinction = vec3f( 0.0 );
		var scattering = vec3f( 0.0 );
		var maxAlbedo = vec3f( 0.0 );
		var anisotropy = 0.0;
		var anisotropyWeight = 0.0;
		var ids = stack.ids;
		for ( var i = 0u; i < ${ MEDIUM_STACK_SIZE }u; i ++ ) {

			if ( ids[ i ] == ${ MEDIUM_STACK_EMPTY }u ) {

				continue;

			}

			let material = ${ materialsStorage }[ ids[ i ] ];
			let entryAnisotropy = clamp( material.scatterAnisotropy, - ${ MEDIUM_MAX_ANISOTROPY }, ${ MEDIUM_MAX_ANISOTROPY } );
			let entryExtinction = ${ getMaterialExtinctionFn }( material.attenuationColor, material.attenuationDistance );

			// a fog volume's color is its single scatter albedo already
			let entryAlbedo = select( vec3f( 0.0 ), material.multiscatterColor, material.fogVolume != 0 );
			let entryScattering = entryAlbedo * entryExtinction;
			let weight = dot( entryScattering, vec3f( 1.0 / 3.0 ) );
			extinction += entryExtinction;
			scattering += entryScattering;
			maxAlbedo = max( maxAlbedo, entryAlbedo );
			anisotropy += entryAnisotropy * weight;
			anisotropyWeight += weight;

		}

		// channels without extinction keep the largest albedo for the channel choice
		var medium: ${ mediumStruct };
		medium.stack = stack;
		medium.subsurface = 0u;
		medium.extinction = extinction;
		medium.albedo = select( maxAlbedo, scattering / extinction, extinction > vec3f( 0.0 ) );
		medium.anisotropy = select( 0.0, anisotropy / anisotropyWeight, anisotropyWeight > 0.0 );
		medium.scatters = select( 0u, 1u, any( medium.albedo > vec3f( 0.0 ) ) && any( extinction > vec3f( 0.0 ) ) );
		return medium;

	}

`;

// Returns the medium of a subsurface walk through the material's volume. The walk isn't on the stack, which is
// kept for the media the path is in once it leaves
export const getSubsurfaceMediumFn = wgslTagFn/* wgsl */`

	fn getSubsurfaceMedium( materialIndex: u32, stack: ${ mediumStackStruct } ) -> ${ mediumStruct } {

		let material = ${ materialsStorage }[ materialIndex ];
		let anisotropy = clamp( material.scatterAnisotropy, - ${ MEDIUM_MAX_ANISOTROPY }, ${ MEDIUM_MAX_ANISOTROPY } );

		var medium: ${ mediumStruct };
		medium.stack = stack;
		medium.subsurface = 1u;
		medium.extinction = ${ getMaterialExtinctionFn }( material.attenuationColor, material.attenuationDistance );
		medium.albedo = ${ getSingleScatterAlbedoFn }( material.multiscatterColor * material.scatterStrength, anisotropy );
		medium.anisotropy = anisotropy;
		medium.scatters = select( 0u, 1u, any( medium.albedo > vec3f( 0.0 ) ) && any( medium.extinction > vec3f( 0.0 ) ) );
		return medium;

	}

`;

// Returns whether refracting into the material's volume starts a subsurface walk rather than entering the stack
export const isSubsurfaceMaterialFn = wgslTagFn/* wgsl */`

	fn isSubsurfaceMaterial( materialIndex: u32 ) -> bool {

		let material = ${ materialsStorage }[ materialIndex ];
		return material.fogVolume == 0 && material.scatterStrength > 0.0 && any( material.multiscatterColor > vec3f( 0.0 ) ) &&
			any( ${ getMaterialExtinctionFn }( material.attenuationColor, material.attenuationDistance ) > vec3f( 0.0 ) );

	}

`;

// Returns the stack a surface's shadow ray starts in. A light on the far side of a volume's boundary is reached
// through it, entering or leaving the volume
export const getShadowMediumStackFn = wgslTagFn/* wgsl */`

	fn getShadowMediumStack(
		stack: ${ mediumStackStruct }, materialIndex: u32, side: f32, thinWall: bool,
		direction: vec3f, lightDirection: vec3f, normal: vec3f,
	) -> ${ mediumStackStruct } {

		var result = stack;
		let crossesSurface = dot( direction, normal ) * dot( lightDirection, normal ) > 0.0;
		if ( crossesSurface && ! thinWall ) {

			if ( side > 0.0 ) {

				${ addToMediumStackFn }( &result, materialIndex );

			} else {

				${ removeFromMediumStackFn }( &result, materialIndex );

			}

		}

		return result;

	}

`;

// Returns the distance a shadow ray's fog depth is measured back from: the light's. A distant light is outside of
// every closed volume, so the depth is measured from the origin instead, where a far distance would lose its precision
export const getFogShadowDistanceFn = wgslTagFn/* wgsl */`

	fn getFogShadowDistance( maxDist: f32 ) -> f32 {

		return select( maxDist, 0.0, maxDist >= ${ MEDIUM_DISTANT_SHADOW_DISTANCE } );

	}

`;

// Returns the optical depth of the media a shadow ray starts in, up to the fog shadow distance. The traversal passes
// fog boundaries in any order, adding their depth back from the same distance, so together they cover the ray
export const getShadowMediumDepthFn = wgslTagFn/* wgsl */`

	fn getShadowMediumDepth( stack: ${ mediumStackStruct }, maxDist: f32 ) -> vec3f {

		return ${ getCombinedMediumFn }( stack ).extinction * ${ getFogShadowDistanceFn }( maxDist );

	}

`;

// Returns the light a shadow ray lets through: what the partially transparent surfaces passed let through, times
// the transmittance of the media of the given optical depth on the way
export const getShadowTransmittanceFn = wgslTagFn/* wgsl */`

	fn getShadowTransmittance( depth: vec3f, occlusion: f32 ) -> vec3f {

		return ( 1.0 - occlusion ) * exp( - max( depth, vec3f( 0.0 ) ) );

	}

`;

// Returns the probability of sampling each color channel's distance, in proportion to throughput times albedo
// https://github.com/blender/cycles/blob/a456b761034dda42c32eef9f4aae0fa5a5c9f604/src/kernel/closure/volume.h#L157
export const getMediumChannelPdfFn = wgslTagFn/* wgsl */`

	fn getMediumChannelPdf( throughput: vec3f, albedo: vec3f ) -> vec3f {

		let weights = abs( throughput * albedo );
		let weightSum = weights.r + weights.g + weights.b;
		if ( weightSum > 0.0 ) {

			return weights / weightSum;

		}

		return vec3f( 1.0 / 3.0 );

	}

`;

// returns the sampled distance to the next scatter event, using one color channel's extinction
export const sampleMediumDistanceFn = wgslTagFn/* wgsl */`

	fn sampleMediumDistance( medium: ${ mediumStruct }, channelPdf: vec3f, u: vec2f ) -> f32 {

		var channel = 2u;
		if ( u.x < channelPdf.r ) {

			channel = 0u;

		} else if ( u.x < channelPdf.r + channelPdf.g ) {

			channel = 1u;

		}

		// a channel with no extinction never scatters, and WGSL doesn't guarantee an infinite quotient
		let extinction = medium.extinction[ channel ];
		if ( extinction <= 0.0 ) {

			return ${ LIGHT_FAR_DISTANCE };

		}

		return - log( 1.0 - u.y ) / extinction;

	}

`;

// returns the per channel pdf of a segment: of scattering at "dist", or of passing it when it didn't scatter
export const getMediumDistancePdfFn = wgslTagFn/* wgsl */`

	fn getMediumDistancePdf( medium: ${ mediumStruct }, dist: f32, scattered: bool ) -> vec3f {

		let transmittance = exp( - medium.extinction * dist );
		return select( transmittance, medium.extinction * transmittance, scattered );

	}

`;

// Returns the scatter distance sampled for a segment in fog, which the segment is traced up to, or zero outside of fog
export const sampleFogDistanceFn = wgslTagFn/* wgsl */`

	fn sampleFogDistance( medium: ${ mediumStruct }, throughput: vec3f, u: vec2f ) -> f32 {

		if ( medium.scatters == 0u || medium.subsurface != 0u ) {

			return 0.0;

		}

		return ${ sampleMediumDistanceFn }( medium, ${ getMediumChannelPdfFn }( throughput, medium.albedo ), u );

	}

`;

// Returns the weight of a segment in fog traced up to its scatter distance: of scattering there, when no surface is
// nearer, or of reaching the surface. Zero when the segment's pdf is
export const getFogSegmentWeightFn = wgslTagFn/* wgsl */`

	fn getFogSegmentWeight( medium: ${ mediumStruct }, throughput: vec3f, scatterDist: f32, surfaceDist: f32 ) -> vec3f {

		let scattered = scatterDist < surfaceDist;
		let segmentDist = select( surfaceDist, scatterDist, scattered );
		let transmittance = exp( - medium.extinction * segmentDist );
		let distancePdf = dot( ${ getMediumChannelPdfFn }( throughput, medium.albedo ), ${ getMediumDistancePdfFn }( medium, segmentDist, scattered ) );
		if ( distancePdf <= 0.0 ) {

			return vec3f( 0.0 );

		}

		return select( transmittance, medium.albedo * medium.extinction * transmittance, scattered ) / distancePdf;

	}

`;
