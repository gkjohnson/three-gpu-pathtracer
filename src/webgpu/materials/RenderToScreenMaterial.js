import { MeshBasicNodeMaterial, NoToneMapping } from 'three/webgpu';
import { uv, varying, texture, vec4, toneMapping, uniform, wgslFn } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { createOutputTarget } from '../compute/targets.js';

// TODO: we could fall back to hardware-based filtering if available but it has to be specifically
// requested and available on the renderer which we don't have access to immediately. It's possible this
// can be detected during build time via a custom node to adjust the sample approach used?
// the color at a texel of the path tracer's output target, which stores a channel per layer
const loadTexelFn = wgslFn( /* wgsl */`
	fn loadTexel( tex: texture_2d_array<f32>, texel: vec2i ) -> vec4f {

		let coord = clamp( texel, vec2i( 0 ), vec2i( textureDimensions( tex, 0 ) ) - 1 );
		return vec4f(
			textureLoad( tex, coord, 0, 0 ).r,
			textureLoad( tex, coord, 1, 0 ).r,
			textureLoad( tex, coord, 2, 0 ).r,
			textureLoad( tex, coord, 3, 0 ).r,
		);

	}
` );

const sampleTexelFn = wgslTagFn/* wgsl */`
	fn sampleTexel( tex: texture_2d_array<f32>, coord: vec2f, nearest: u32 ) -> vec4f {

		// Manual bilinear filtering using textureLoad to support filterable float32 textures
		// on all devices
		let size = vec2f( textureDimensions( tex, 0 ) );

		// the path tracer stores its color rows top down
		let texelCoord = vec2f( coord.x, 1.0 - coord.y ) * size;
		if ( nearest != 0u ) {

			return ${ loadTexelFn }( tex, vec2i( floor( texelCoord ) ) );

		}

		let pxCoord = texelCoord - 0.5;
		let px = vec2i( floor( pxCoord ) );
		let fr = fract( pxCoord );

		// get the four sibling samples
		let s00 = ${ loadTexelFn }( tex, px );
		let s10 = ${ loadTexelFn }( tex, px + vec2i( 1, 0 ) );
		let s01 = ${ loadTexelFn }( tex, px + vec2i( 0, 1 ) );
		let s11 = ${ loadTexelFn }( tex, px + vec2i( 1, 1 ) );

		// interpolate on the x axis
		let y0 = mix( s00, s10, fr.x );
		let y1 = mix( s01, s11, fr.x );

		// then y
		return mix( y0, y1, fr.y );

	}
`;

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

	get nearest() {

		return this._nearestUniform.value === 1;

	}

	set nearest( v ) {

		this._nearestUniform.value = v ? 1 : 0;

	}

	get showPreview() {

		return this._showPreviewUniform.value === 1;

	}

	set showPreview( v ) {

		this._showPreviewUniform.value = v ? 1 : 0;

	}

	get exposure() {

		return this._toneMapping.exposureNode.value;

	}

	set exposure( v ) {

		this._toneMapping.exposureNode.value = v;

	}

	constructor( params ) {

		super();

		// placeholders with the output target's layout, so the shader is built for it
		const texNode = texture( createOutputTarget() );
		this._texNode = texNode;

		const fromTexNode = texture( createOutputTarget() );
		this._fromTexNode = fromTexNode;

		const texUV = varying( uv() );

		const transitionUniform = uniform( 1.0 );
		this._transitionUniform = transitionUniform;

		// whether the textures are read without interpolation
		const nearestUniform = uniform( 0, 'uint' );
		this._nearestUniform = nearestUniform;

		const showPreviewUniform = uniform( 0, 'uint' );
		this._showPreviewUniform = showPreviewUniform;

		// the render faded in over the preview, which shows through the pixels the render hasn't reached
		// NOTE: varyings cannot be referenced directly and must be passed as arguments
		const getFadedColorFn = wgslTagFn/* wgsl */`
			fn fade( uv: vec2f ) -> vec4f {

				let color = ${ sampleTexelFn }( ${ texNode }, uv, ${ nearestUniform } );
				if ( ${ showPreviewUniform } == 0u ) {

					return color;

				}

				let preview = ${ sampleTexelFn }( ${ fromTexNode }, uv, ${ nearestUniform } );
				let colorAlpha = color.a * ${ transitionUniform };
				return vec4f( mix( preview.rgb, color.rgb, colorAlpha ), mix( preview.a, 1.0, colorAlpha ) );

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
