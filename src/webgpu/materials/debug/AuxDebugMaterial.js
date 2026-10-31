import { MeshBasicNodeMaterial, NoBlending } from 'three/webgpu';
import { uv, varying, texture, uniform } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { createAuxTarget } from '../../compute/targets.js';
import { unpackAuxAlbedoFn, unpackAuxNormalFn, AUX_LAYERS } from '../../nodes/aux.wgsl.js';

// Shows the albedo or normal the path tracer accumulates for the denoiser
export class AuxDebugMaterial extends MeshBasicNodeMaterial {

	set texture( v ) {

		this._texNode.value = v;

	}

	set showNormal( v ) {

		this._showNormalUniform.value = v ? 1 : 0;

	}

	constructor() {

		super();

		this.blending = NoBlending;

		this._texNode = texture( createAuxTarget() );
		this._showNormalUniform = uniform( 0, 'uint' );

		const auxDebug = wgslTagFn/* wgsl */`
			fn auxDebug( tex: texture_2d_array<u32>, coord: vec2f, showNormal: u32 ) -> vec4f {

				// the rows are stored top down, so the quad's bottom up uv is flipped
				let texel = vec2u( vec2f( coord.x, 1.0 - coord.y ) * vec2f( textureDimensions( tex, 0 ) ) );
				var packed: vec3u;
				for ( var layer = 0u; layer < ${ AUX_LAYERS }u; layer ++ ) {

					packed[ layer ] = textureLoad( tex, texel, layer, 0 ).r;

				}

				let albedo = ${ unpackAuxAlbedoFn }( packed );
				let normal = ${ unpackAuxNormalFn }( packed );
				return vec4f( select( albedo, normal, showNormal == 1u ), 1.0 );

			}
		`;

		this.colorNode = auxDebug( this._texNode, varying( uv() ), this._showNormalUniform );

	}

}
