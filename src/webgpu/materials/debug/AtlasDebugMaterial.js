import { MeshBasicNodeMaterial, DataTexture, NoBlending } from 'three/webgpu';
import { uv, varying, texture, uniform, wgslFn } from 'three/tsl';

export class AtlasDebugMaterial extends MeshBasicNodeMaterial {

	set texture( v ) {

		this._texNode.value = v;

	}

	set layer( v ) {

		this._layerUniform.value = v;

	}

	constructor() {

		super();

		this.blending = NoBlending;

		this._texNode = texture( new DataTexture() );
		this._layerUniform = uniform( 0 );

		// Shows one layer of the atlas array texture.
		this.colorNode = wgslFn( /* wgsl */ `
			fn atlasDebug( tex: texture_2d_array<f32>, coord: vec2f, layer: f32 ) -> vec4f {

				// flip y so texel origin shows at the top-left
				let dims = vec2f( textureDimensions( tex, 0 ).xy );
				let texel = vec2i( vec2f( coord.x, 1.0 - coord.y ) * dims );
				return textureLoad( tex, texel, i32( layer ), 0 );

			}
		` )( this._texNode, varying( uv() ), this._layerUniform );

	}

}
