import { MeshBasicNodeMaterial, StorageTexture } from 'three/webgpu';
import { uv, varying, texture, vec4, uniform, wgslFn } from 'three/tsl';
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

// Composites the path tracer output ( with the low-res -> full-res fade ) to the screen. Tone
// mapping and color space conversion are left to the renderer's normal output pass.
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

	get transition() {

		return this._transitionUniform.value;

	}

	set transition( v ) {

		this._transitionUniform.value = v;

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

		const fadedColor = getFadedColorFn( texUV );

		// premultiply alpha for compositing; tone mapping and color space conversion are applied by
		// the renderer's normal output pass.
		// NOTE: alpha is being multiplied twice here to accommodate some odd blending in three.js
		// See mrdoob/three.js#33104. It's possible this should be removed or rethought once fixed.
		this.transparent = true;
		this.colorNode = vec4( fadedColor.rgb.mul( fadedColor.a ), fadedColor.a );

		this.setValues( params );

	}

}
