/** @import { Texture, WebGPURenderer } from 'three/webgpu' */
import { HalfFloatType, RGBAFormat, StorageTexture } from 'three/webgpu';
import { globalId, texture, textureStore, uniform } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { ComputeKernel } from '../compute/ComputeKernel.js';

// a texel outside every triangle takes the average of its filled neighbors, so each pass grows
// the filled region by one texel
class FillGuttersKernel extends ComputeKernel {

	constructor() {

		const params = {
			globalId: globalId,
			src: texture( new StorageTexture( 1, 1 ) ).setSampler( false ),
			ids: texture( new StorageTexture( 1, 1 ) ).setSampler( false ),
			dst: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			first: uniform( 1 ),
		};

		const isFilled = wgslTagFn/* wgsl */`
			fn isFilled( s: vec4f, texel: vec2i ) -> bool {

				// the ids may be at a higher resolution than the map, so the texel center is scaled into them
				if ( ${ params.first } > 0.5 ) {

					let mapDims = vec2f( textureDimensions( ${ params.src }, 0 ) );
					let idDims = vec2f( textureDimensions( ${ params.ids }, 0 ) );
					let idTexel = vec2i( ( vec2f( texel ) + 0.5 ) * idDims / mapDims );
					return textureLoad( ${ params.ids }, idTexel, 0 ).r > 0.0;

				}

				return s.a > 0.5;

			}
		`;

		const fn = wgslTagFn/* wgsl */`
			fn compute( globalId: vec3u ) -> void {

				let dims = vec2i( textureDimensions( ${ params.src }, 0 ) );
				let texel = vec2i( globalId.xy );
				if ( texel.x >= dims.x || texel.y >= dims.y ) {

					return;

				}

				// the first pass reads coverage from the triangle ids, later ones from the alpha it wrote
				let center = textureLoad( ${ params.src }, texel, 0 );
				if ( ${ isFilled }( center, texel ) ) {

					textureStore( ${ params.dst }, globalId.xy, vec4f( center.rgb, 1.0 ) );
					return;

				}

				var sum = vec3f( 0.0 );
				var count = 0.0;
				for ( var dy = - 1; dy <= 1; dy ++ ) {

					for ( var dx = - 1; dx <= 1; dx ++ ) {

						let c = clamp( texel + vec2i( dx, dy ), vec2i( 0 ), dims - 1 );
						let s = textureLoad( ${ params.src }, c, 0 );
						if ( ${ isFilled }( s, c ) ) {

							sum += s.rgb;
							count += 1.0;

						}

					}

				}

				var result = vec4f( 0.0 );
				if ( count > 0.0 ) {

					result = vec4f( sum / count, 1.0 );

				}

				textureStore( ${ params.dst }, globalId.xy, result );

			}
		`;

		super( fn( params ), { workgroupSize: [ 8, 8 ] } );

		this.defineUniformAccessors( {
			src: params.src,
			ids: params.ids,
			dst: params.dst,
			first: params.first,
		} );

	}

}

/**
 * Spreads the covered texels of a baked map into the empty gutters between its charts so texture
 * filtering at chart edges does not pick up empty texels.
 */
export class GutterFiller {

	/**
	 * @param {WebGPURenderer} renderer
	 * @param {number} size - Width and height of the maps in texels.
	 */
	constructor( renderer, size ) {

		this.renderer = renderer;
		this.size = size;
		this.kernel = new FillGuttersKernel();

		// the passes alternate between this and the target
		this.scratch = this.createTarget();

	}

	/**
	 * Returns a new texture "fill" can write its result into, owned by the caller.
	 *
	 * @returns {StorageTexture}
	 */
	createTarget() {

		// half float so it can be sampled with filtering
		const { size } = this;
		const target = new StorageTexture( size, size );
		target.format = RGBAFormat;
		target.type = HalfFloatType;
		target.generateMipmaps = false;
		return target;

	}

	/**
	 * Returns a copy of the map with its gutters filled, written into the target or a new texture owned
	 * by the caller.
	 *
	 * @param {Texture} map - The baked map.
	 * @param {Texture} ids - Triangle ids of the map, zero where no triangle covers the texel.
	 * @param {StorageTexture} [target] - A texture from "createTarget" to write into.
	 * @param {number} [passes=8] - Texels to grow the charts by.
	 * @returns {StorageTexture}
	 */
	fill( map, ids, target = this.createTarget(), passes = 8 ) {

		const { renderer, kernel, scratch, size } = this;
		const dispatchSize = kernel.getDispatchSize( size, size, 1 );

		// alternate so the last pass writes the target
		let src = map;
		for ( let i = 0; i < passes; i ++ ) {

			const dst = ( passes - i ) % 2 === 1 ? target : scratch;
			kernel.src = src;
			kernel.ids = ids;
			kernel.dst = dst;
			kernel.first = i === 0 ? 1 : 0;
			renderer.compute( kernel.kernel, dispatchSize );
			src = dst;

		}

		return target;

	}

	dispose() {

		this.kernel.dispose();
		this.scratch.dispose();

	}

}
