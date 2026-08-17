import { MeshBasicNodeMaterial, NoBlending, StorageTexture } from 'three/webgpu';
import { uv, varying, texture, uniform } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { heatColorFn } from '../../nodes/debugBounds.wgsl.js';
import { SAMPLE_COUNT_MASK } from '../../compute/TallySampleCountsKernel.js';

// Shows how many samples each pixel has accumulated using the same heat ramp as the bvh bounds
// overlay, so uneven convergence across the image is visible directly.
export class SampleDensityMaterial extends MeshBasicNodeMaterial {

	set texture( v ) {

		this._texNode.value = v;

	}

	// sample count mapped to the cold end of the ramp
	set minCount( v ) {

		this._minUniform.value = v;

	}

	// sample count mapped to full heat
	set maxCount( v ) {

		this._maxUniform.value = v;

	}

	constructor() {

		super();

		this.blending = NoBlending;

		this._texNode = texture( new StorageTexture( 1, 1 ) );
		this._minUniform = uniform( 0 );
		this._maxUniform = uniform( 1 );

		const sampleDensity = wgslTagFn/* wgsl */`
			fn sampleDensity( tex: texture_2d<u32>, coord: vec2f, minCount: f32, maxCount: f32 ) -> vec4f {

				let dims = vec2f( textureDimensions( tex, 0 ) );
				let texel = vec2i( coord * dims );

				// the high bits hold the ray state flags rather than part of the count
				let samples = textureLoad( tex, texel, 0 ).r & ${ SAMPLE_COUNT_MASK }u;

				// stretched across the recorded range rather than from zero, otherwise a converged
				// image with counts bunched near the max reads as uniformly hot
				let range = max( maxCount - minCount, 1.0 );
				let t = clamp( ( f32( samples ) - minCount ) / range, 0.0, 1.0 );

				return vec4f( ${ heatColorFn }( t ), 1.0 );

			}
		`;

		this.colorNode = sampleDensity( this._texNode, varying( uv() ), this._minUniform, this._maxUniform );

	}

}
