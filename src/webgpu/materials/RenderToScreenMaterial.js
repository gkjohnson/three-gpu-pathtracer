import { MeshBasicNodeMaterial, NoToneMapping, StorageTexture } from 'three/webgpu';
import { uv, varying, texture, vec4, toneMapping, uniform, wgslFn } from 'three/tsl';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode.js';

// TODO: we could fall back to hardware-based filtering if available but it has to be specifically
// requested and available on the renderer which we don't have access to immediately. It's possible this
// can be detected during build time via a custom node to adjust the sample approach used?
const sampleTexelFn = wgslFn( /* wgsl */`
	fn sampleTexel( tex: texture_2d<f32>, coord: vec2f ) -> vec4f {

		// Manual bilinear filtering using textureLoad to support filterable float32 textures
		// on all devices
		let size = vec2f( textureDimensions( tex, 0 ) );
		let pxCoord = coord * size - 0.5;
		let px = vec2i( floor( pxCoord ) );
		let fr = fract( pxCoord );

		// get the four sibling samples
		let s00 = textureLoad( tex, clamp( px,                 vec2i( 0 ), vec2i( size ) - 1 ), 0 );
		let s10 = textureLoad( tex, clamp( px + vec2i( 1, 0 ), vec2i( 0 ), vec2i( size ) - 1 ), 0 );
		let s01 = textureLoad( tex, clamp( px + vec2i( 0, 1 ), vec2i( 0 ), vec2i( size ) - 1 ), 0 );
		let s11 = textureLoad( tex, clamp( px + vec2i( 1, 1 ), vec2i( 0 ), vec2i( size ) - 1 ), 0 );

		// interpolate on the x axis
		let y0 = mix( s00, s10, fr.x );
		let y1 = mix( s01, s11, fr.x );

		// then y
		return mix( y0, y1, fr.y );

	}
` );

// Material to apply tone mapping _before_ applying alpha blending
export class RenderToScreenNodeMaterial extends MeshBasicNodeMaterial {

	get texture() {

		return this._texNode.value;

	}

	set texture( v ) {

		this._texNode.value = v;

	}

	get fromTexture() {

		return this._fromTexNode.value;

	}

	set fromTexture( v ) {

		this._fromTexNode.value = v;

	}

	get toneMapping() {

		return this._toneMapping.toneMapping;

	}

	set toneMapping( v ) {

		this._toneMapping.setToneMapping( v );

	}

	get transition() {

		return this._transitionUniform.value;

	}

	set transition( v ) {

		this._transitionUniform.value = v;

	}

	get exposure() {

		return this._toneMapping.exposureNode.value;

	}

	set exposure( v ) {

		this._toneMapping.exposureNode.value = v;

	}

	constructor( params ) {

		super();

		const texNode = texture( new StorageTexture() );
		this._texNode = texNode;

		const fromTexNode = texture( new StorageTexture() );
		this._fromTexNode = fromTexNode;

		const texUV = varying( uv() );

		const transitionUniform = uniform( 1.0 );
		this._transitionUniform = transitionUniform;

		// NOTE: varyings cannot be referenced directly and must be passed as arguments
		const getFadedColorFn = wgslTagFn/* wgsl */`
			fn fade( uv: vec2f ) -> vec4f {

				if ( ${ transitionUniform } <= 0.0 ) {

					return ${ sampleTexelFn }( ${ fromTexNode }, uv );

				} else if ( ${ transitionUniform } >= 1.0 ) {

					return ${ sampleTexelFn }( ${ texNode }, uv );

				} else {

					let col0 = ${ sampleTexelFn }( ${ fromTexNode }, uv );
					let col1 = ${ sampleTexelFn }( ${ texNode }, uv );
					return mix( col0, col1, ${ transitionUniform } );

				}

			}
		`;

		const toneMappingNode = toneMapping( NoToneMapping, 1.0, getFadedColorFn( texUV ) );
		this._toneMapping = toneMappingNode;

		// apply alpha _after_ applying tone mapping
		// NOTE: alpha is being multiplied twice here to accommodate some odd blending in three.js
		// See mrdoob/three.js#33104. It's possible this should be removed or rethought once fixed.
		this.transparent = true;
		this.colorNode = vec4( toneMappingNode.rgb, toneMappingNode.a );

		this.setValues( params );

	}

}
