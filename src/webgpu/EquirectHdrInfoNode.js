import { Matrix3, DataTexture, LinearFilter } from 'three/webgpu';
import { texture, sampler, uniform, PI } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { EnvironmentCdfTexture } from './EnvironmentCdfTexture.js';
import { readCdfFn, searchCdfFn } from './nodes/cdf.wgsl.js';
import { environmentSampleStruct } from './nodes/structs.wgsl.js';
import { equirectDirectionToUvFn, equirectUvToDirectionFn } from './nodes/sampling.wgsl.js';

// An equirect environment map and its importance sampling CDFs, built on the GPU, with the functions that sample it
export class EquirectHdrInfoNode {

	constructor() {

		// a black map until one is set
		const defaultMap = new DataTexture( new Uint8Array( 4 ), 1, 1 );
		defaultMap.minFilter = LinearFilter;
		defaultMap.magFilter = LinearFilter;
		defaultMap.needsUpdate = true;

		this.defaultMap = defaultMap;
		this.cdfTexture = new EnvironmentCdfTexture();

		// the environment map with a sampler, and its CDFs
		this.mapNode = texture( defaultMap );
		this.mapSampler = sampler( this.mapNode );
		this.cdfTextureNode = texture( this.cdfTexture ).setName( 'envCdf' );

		// scalar parameters that assemble into the EnvironmentInfo struct in the shader
		this.rotationNode = uniform( new Matrix3() );
		this.intensityNode = uniform( 1 );

		this._initFns();

	}

	// samples the given equirect map, building its CDFs
	updateFrom( renderer, envMap ) {

		this.mapNode.value = envMap;
		this.cdfTexture.generate( renderer, envMap );

	}

	dispose() {

		this.defaultMap.dispose();
		this.cdfTexture.dispose();

	}

	_initFns() {

		const {
			mapNode,
			mapSampler,
			cdfTextureNode,
			rotationNode,
			intensityNode,
		} = this;

		// the sum of the map's pixel weights, the CDFs' last entry
		this.getTotalSum = wgslTagFn/* wgsl */`
			fn getEnvTotalSum() -> f32 {

				let resolution = textureDimensions( ${ mapNode } );
				return ${ readCdfFn }( ${ cdfTextureNode }, resolution.y + 1u + resolution.y * ( resolution.x + 1u ) );

			}
		`;

		// the solid angle pdf of a direction at "v" in the given pixel, which is sampled uniformly over its area
		const getTexelPdfFn = wgslTagFn/* wgsl */`
			fn getEnvTexelPdf( texel: vec2u, v: f32 ) -> f32 {

				let resolution = textureDimensions( ${ mapNode } );
				let rowOffset = resolution.y + 1u + texel.y * ( resolution.x + 1u );
				let rowPdf = ${ readCdfFn }( ${ cdfTextureNode }, texel.y + 1u ) - ${ readCdfFn }( ${ cdfTextureNode }, texel.y );
				let pixelPdf = ${ readCdfFn }( ${ cdfTextureNode }, rowOffset + texel.x + 1u ) - ${ readCdfFn }( ${ cdfTextureNode }, rowOffset + texel.x );

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
				let row = ${ searchCdfFn }( ${ cdfTextureNode }, r.x, 0u, resolution.y, &rowFraction );
				let column = ${ searchCdfFn }( ${ cdfTextureNode }, r.y, resolution.y + 1u + row * ( resolution.x + 1u ), resolution.x, &columnFraction );
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
				return ${ intensityNode } * ${ PI } * ${ PI } * ${ this.getTotalSum }() / ( 2.0 * f32( resolution.x * resolution.y ) );

			}
		`;

		this.getDirPdf = wgslTagFn/* wgsl */`
			fn getEnvDirPdf( direction: vec3f ) -> f32 {

				if ( ${ this.getTotalSum }() == 0.0 ) {

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
