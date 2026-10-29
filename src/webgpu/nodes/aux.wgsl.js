import { wgslTagFn } from 'three-mesh-bvh/webgpu';

// The denoiser's auxiliary images, the first hit albedo and normal, accumulate in an "r32uint" array
// texture, the one kind of storage texture core WebGPU can both read and write. Each layer packs two
// halves: albedo.rg, then albedo.b and normal.z, then normal.xy. Normals are mapped to [0,1].
export const AUX_LAYERS = 3;

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
