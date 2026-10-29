import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { scatterRecordStruct, surfaceRecordStruct } from './structs.wgsl.js';

// The denoiser's auxiliary images, the first hit albedo and normal, accumulate in an "r32uint" array
// texture, the one kind of storage texture core WebGPU can both read and write. Each layer packs two
// halves: albedo.rg, then albedo.b and normal.z, then normal.xy. Normals are mapped to [0,1].
export const AUX_LAYERS = 3;

// the smooth metals the auxiliary images look past to what they reflect, as in mutracer
const AUX_MIRROR_MAX_ROUGHNESS = 0.02;
const AUX_MIRROR_MIN_METALNESS = 0.98;

// whether a scatter shows its surface in the auxiliary images, rather than looking past it through a
// transmission or a mirror
export const isAuxSurfaceFn = wgslTagFn/* wgsl */`

	fn isAuxSurface( surface: ${ surfaceRecordStruct }, scatterRec: ${ scatterRecordStruct } ) -> bool {

		let isMirror = surface.roughness <= ${ AUX_MIRROR_MAX_ROUGHNESS } && surface.metalness >= ${ AUX_MIRROR_MIN_METALNESS };
		return ! scatterRec.isTransmissive && ! isMirror;

	}

`;

export const unpackAuxAlbedoFn = wgslTagFn/* wgsl */`

	fn unpackAuxAlbedo( packed: vec3u ) -> vec3f {

		return vec3f( unpack2x16float( packed.x ), unpack2x16float( packed.y ).x );

	}

`;

export const unpackAuxNormalFn = wgslTagFn/* wgsl */`

	fn unpackAuxNormal( packed: vec3u ) -> vec3f {

		return vec3f( unpack2x16float( packed.z ), unpack2x16float( packed.y ).y );

	}

`;

// blends a sample's albedo and normal into the packed running means
export const blendAuxFn = wgslTagFn/* wgsl */`

	fn blendAux( packed: vec3u, albedo: vec3f, normal: vec3f, weight: f32 ) -> vec3u {

		let meanAlbedo = mix( ${ unpackAuxAlbedoFn }( packed ), albedo, weight );
		let meanNormal = mix( ${ unpackAuxNormalFn }( packed ), normal * 0.5 + 0.5, weight );
		return vec3u(
			pack2x16float( meanAlbedo.rg ),
			pack2x16float( vec2f( meanAlbedo.b, meanNormal.z ) ),
			pack2x16float( meanNormal.xy ),
		);

	}

`;
