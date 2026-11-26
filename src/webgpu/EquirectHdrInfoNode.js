import { Matrix3, DataTexture, LinearFilter } from 'three/webgpu';
import { texture, sampler, uniform, PI } from 'three/tsl';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';
import { EnvironmentCdfTexture, getEnvPatchFns } from './EnvironmentCdfTexture.js';
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

		const { getEdgeFn, getCornersFn } = getEnvPatchFns( mapNode, this.cdfTexture.wrapNode );

		// the sum of the map's patch weights, the CDFs' last entry
		this.getTotalSum = wgslTagFn/* wgsl */`
			fn getEnvTotalSum() -> f32 {

				let resolution = textureDimensions( ${ mapNode } );
				return ${ readCdfFn }( ${ cdfTextureNode }, resolution.y + 2u + ( resolution.y + 1u ) * ( resolution.x + 2u ) );

			}
		`;

		// places a [0, 1) sample in proportion to the linear function from "a" to "b", from pbrt-v4's "SampleLinear"
		const sampleLinearFn = wgslTagFn/* wgsl */`
			fn sampleEnvLinear( u: f32, a: f32, b: f32 ) -> f32 {

				let denominator = a + sqrt( mix( a * a, b * b, u ) );
				return select( u, min( u * ( a + b ) / denominator, 0.99999994 ), denominator > 0.0 );

			}
		`;

		// the solid angle pdf of a direction at "uv", at "local" within the patch with the given corner weights
		const getPatchPdfFn = wgslTagFn/* wgsl */`
			fn getEnvPatchPdf( corners: vec4f, local: vec2f, uv: vec2f ) -> f32 {

				// the bilinear weight over the total is the pdf over the map in texels
				let weight = mix( mix( corners.x, corners.y, local.x ), mix( corners.z, corners.w, local.x ), local.y );
				let total = ${ this.getTotalSum }();
				let resolution = vec2f( textureDimensions( ${ mapNode } ) );

				// the equirect projection stretches the map by 1 / sin( theta ) over the sphere
				let sinTheta = sin( ${ PI } * uv.y );
				let isValid = sinTheta > 0.0 && total > 0.0;
				return select( 0.0, weight * resolution.x * resolution.y / ( total * 2.0 * ${ PI } * ${ PI } * sinTheta ), isValid );

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

				// search the CDFs: marginal picks the patch row (v), conditional picks the patch in it (u), and
				// the fractions place the sample within the patch in proportion to its bilinear weight
				let resolution = textureDimensions( ${ mapNode } );
				var rowFraction = 0.0;
				var columnFraction = 0.0;
				let row = ${ searchCdfFn }( ${ cdfTextureNode }, r.x, 0u, resolution.y + 1u, &rowFraction );
				let column = ${ searchCdfFn }( ${ cdfTextureNode }, r.y, resolution.y + 2u + row * ( resolution.x + 2u ), resolution.x + 1u, &columnFraction );
				let cell = vec2u( column, row );

				// the row within the patch from the bilinear marginal, then the column from the conditional at it
				let corners = ${ getCornersFn }( cell );
				var local: vec2f;
				local.y = ${ sampleLinearFn }( rowFraction, corners.x + corners.y, corners.z + corners.w );
				local.x = ${ sampleLinearFn }( columnFraction, mix( corners.x, corners.z, local.y ), mix( corners.y, corners.w, local.y ) );

				let start = ${ getEdgeFn }( cell );
				let end = ${ getEdgeFn }( cell + vec2u( 1u ) );
				let uv = mix( start, end, local ) / vec2f( resolution );

				let direction = ${ equirectUvToDirectionFn }( uv );
				let color = textureSampleLevel( ${ mapNode }, ${ mapSampler }, uv, 0 ).rgb;

				result.direction = transpose( ${ rotationNode } ) * direction;
				result.color = color * ${ intensityNode };
				result.pdf = ${ getPatchPdfFn }( corners, local, uv );

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

				// the patch holding the direction, and where in it the direction falls
				let rotatedDir = ${ rotationNode } * direction;
				let mapUv = ${ equirectDirectionToUvFn }( rotatedDir );
				let resolution = textureDimensions( ${ mapNode } );
				let position = mapUv * vec2f( resolution );
				let cell = min( vec2u( position + 0.5 ), resolution );
				let start = ${ getEdgeFn }( cell );
				let end = ${ getEdgeFn }( cell + vec2u( 1u ) );
				let local = saturate( ( position - start ) / ( end - start ) );

				return ${ getPatchPdfFn }( ${ getCornersFn }( cell ), local, mapUv );

			}
		`;

	}

}
