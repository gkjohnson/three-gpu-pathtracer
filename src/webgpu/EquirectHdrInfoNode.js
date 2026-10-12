import { Matrix3, StorageBufferAttribute } from 'three/webgpu';
import { texture, sampler, uniform, storage, PI } from 'three/tsl';
import { EquirectHdrInfoUniform } from '../uniforms/EquirectHdrInfoUniform.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { environmentSampleStruct } from './nodes/structs.wgsl.js';
import { equirectDirectionToUvFn, equirectUvToDirectionFn } from './nodes/sampling.wgsl.js';

export class EquirectHdrInfoNode extends EquirectHdrInfoUniform {

	constructor() {

		super();

		// environment map with a sampler, and the importance sampling CDFs for the default 1x1 map
		this.mapNode = texture( this.map );
		this.mapSampler = sampler( this.mapNode );
		this.cdfNode = storage( new StorageBufferAttribute( new Float32Array( [ 0, 1, 0, 1 ] ), 1 ), 'float' ).toReadOnly();

		// scalar parameters that assemble into the EnvironmentInfo struct in the shader
		this.rotationNode = uniform( new Matrix3() );
		this.intensityNode = uniform( 1 );
		this.totalSumNode = uniform( this.totalSum );

		this._initFns();

	}

	getPixelWeight( r, g, b, row, height ) {

		// weight the pixel contribution by its spherical solid angle.
		const theta = Math.PI * ( row + 0.5 ) / height;
		return super.getPixelWeight( r, g, b ) * Math.sin( theta );

	}

	updateFrom( envMap ) {

		super.updateFrom( envMap );

		const {
			mapNode,
			cdfNode,
			totalSumNode,
		} = this;

		// refresh values in place on the existing nodes so no rebuild is required
		mapNode.value = this.map;
		totalSumNode.value = this.totalSum;

		// pack the row CDF and then each row's pixel CDF into one buffer, each led by a zero so a
		// pixel's range is two neighboring entries
		const { width, height } = this.map.image;
		const { cdfMarginal, cdfConditional } = this;
		const cdf = new Float32Array( height + 1 + height * ( width + 1 ) );
		cdf.set( cdfMarginal, 1 );
		for ( let y = 0; y < height; y ++ ) {

			cdf.set( cdfConditional.subarray( y * width, y * width + width ), height + 1 + y * ( width + 1 ) + 1 );

		}

		cdfNode.value = new StorageBufferAttribute( cdf, 1 );

	}

	dispose() {

		super.dispose();
		this.cdfNode.value.dispose();

	}

	_initFns() {

		const {
			mapNode,
			mapSampler,
			cdfNode,
			totalSumNode,
			rotationNode,
			intensityNode,
		} = this;

		// Binary searches the "count" pixel ranges from "offset" for the one holding "r", writing where
		// "r" falls within it to "fraction". See:
		// https://pbr-book.org/3ed-2018/Monte_Carlo_Integration/2D_Sampling_with_Multidimensional_Transformations#Piecewise-Constant2DDistributions
		// https://github.com/blender/cycles/blob/main/src/kernel/light/background.h
		const searchCdfFn = wgslTagFn/* wgsl */`
			fn searchEnvCdf( r: f32, offset: u32, count: u32, fraction: ptr<function, f32> ) -> u32 {

				var lower = 0u;
				var upper = count - 1u;
				while ( lower < upper ) {

					let mid = ( lower + upper ) >> 1u;
					if ( ${ cdfNode }[ offset + mid + 1u ] <= r ) {

						lower = mid + 1u;

					} else {

						upper = mid;

					}

				}

				let start = ${ cdfNode }[ offset + lower ];
				let end = ${ cdfNode }[ offset + lower + 1u ];
				*fraction = select( 0.5, saturate( ( r - start ) / ( end - start ) ), end > start );
				return lower;

			}
		`;

		// the solid angle pdf of a direction at "v" in the given pixel, which is sampled uniformly over its area
		const getTexelPdfFn = wgslTagFn/* wgsl */`
			fn getEnvTexelPdf( texel: vec2u, v: f32 ) -> f32 {

				let resolution = textureDimensions( ${ mapNode } );
				let rowOffset = resolution.y + 1u + texel.y * ( resolution.x + 1u );
				let rowPdf = ${ cdfNode }[ texel.y + 1u ] - ${ cdfNode }[ texel.y ];
				let pixelPdf = ${ cdfNode }[ rowOffset + texel.x + 1u ] - ${ cdfNode }[ rowOffset + texel.x ];

				// the equirect projection stretches each pixel by 1 / sin( theta ) over the sphere
				let sinTheta = sin( ${ PI } * v );
				return select( 0.0, rowPdf * pixelPdf * f32( resolution.x * resolution.y ) / ( 2.0 * ${ PI } * ${ PI } * sinTheta ), sinTheta > 0.0 );

			}
		`;

		this.sampleColor = wgslTagFn/* wgsl */`
			fn sampleEnv( direction: vec3f ) -> vec4f {

				let sampleDir = ${ rotationNode } * direction;
				let mapUv = ${ equirectDirectionToUvFn }( sampleDir );
				let col = textureSampleLevel( ${ mapNode }, ${ mapSampler }, mapUv, 0 );

				return vec4f( ${ intensityNode } * col.rgb, col.a );

			}
		`;

		this.sampleDir = wgslTagFn/* wgsl */`
			fn sampleEnvDir( r: vec2f ) -> ${ environmentSampleStruct } {

				var result: ${ environmentSampleStruct };

				// search the CDFs: marginal picks the row (v), conditional picks the column (u), and the
				// fractions place the sample within the pixel
				let resolution = textureDimensions( ${ mapNode } );
				var rowFraction = 0.0;
				var columnFraction = 0.0;
				let row = ${ searchCdfFn }( r.x, 0u, resolution.y, &rowFraction );
				let column = ${ searchCdfFn }( r.y, resolution.y + 1u + row * ( resolution.x + 1u ), resolution.x, &columnFraction );
				let texel = vec2u( column, row );
				let uv = ( vec2f( texel ) + vec2f( columnFraction, rowFraction ) ) / vec2f( resolution );

				let direction = ${ equirectUvToDirectionFn }( uv );
				let color = textureSampleLevel( ${ mapNode }, ${ mapSampler }, uv, 0 ).rgb;

				result.direction = transpose( ${ rotationNode } ) * direction;
				result.color = color * ${ intensityNode };
				result.pdf = ${ getTexelPdfFn }( texel, uv.y );

				return result;

			}
		`;

		// the environment's average irradiance, for weighing it against the lights
		this.getWeight = wgslTagFn/* wgsl */`
			fn getEnvWeight() -> f32 {

				let resolution = textureDimensions( ${ mapNode } );
				return ${ intensityNode } * ${ PI } * ${ PI } * ${ totalSumNode } / ( 2.0 * f32( resolution.x * resolution.y ) );

			}
		`;

		this.getDirPdf = wgslTagFn/* wgsl */`
			fn getEnvDirPdf( direction: vec3f ) -> f32 {

				if ( ${ totalSumNode } == 0.0 ) {

					return 0.0;

				}

				let rotatedDir = ${ rotationNode } * direction;
				let mapUv = ${ equirectDirectionToUvFn }( rotatedDir );
				let resolution = textureDimensions( ${ mapNode } );
				let texel = min( vec2u( mapUv * vec2f( resolution ) ), resolution - 1u );

				return ${ getTexelPdfFn }( texel, mapUv.y );

			}
		`;

	}

}
