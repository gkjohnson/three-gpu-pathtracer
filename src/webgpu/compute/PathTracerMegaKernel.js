import { DataTexture, Matrix3, Vector2, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { texture, sampler, uniform, globalId, textureStore } from 'three/tsl';
import { rngInit, rngNextBounce, rand1, rand2, RNG_INDEX_RAY_JITTER, RNG_INDEX_ENVIRONMENT_SAMPLE, RNG_INDEX_RUSSIAN_ROULETTE } from '../nodes/random.wgsl.js';
import { sampleEnvironmentFn, weightedAlphaBlendFn, luminanceFn } from '../nodes/sampling.wgsl.js';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { isTerminatingScatterFunc } from '../nodes/utils.wgsl.js';

export class PathTracerMegaKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			material: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			seed: uniform( 0 ),
			bounces: uniform( 5 ),
			filterGlossy: uniform( 1 ),

			// environment
			envMap: texture( new DataTexture() ),
			envMapSampler: sampler( new DataTexture() ),
			envMapRotation: uniform( new Matrix3() ),
			envMapIntensity: uniform( 1 ),

			background: texture( new DataTexture() ),
			backgroundSampler: sampler( new DataTexture() ),
			backgroundRotation: uniform( new Matrix3() ),
			backgroundIntensity: uniform( 1 ),
			backgroundBlurriness: uniform( 0 ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			// compute variables
			globalId: globalId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxyFn( 'bvhData.value.fns.raycastFirstHit', params );
		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const getSurfaceRecordFn = proxyFn( 'bvhData.value.fns.getSurfaceRecord', params );
		const getCameraRayFn = proxyFn( 'bvhData.value.fns.getCameraRay', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );

		const shader = wgslTagFn/* wgsl */`

			fn compute(

				// indices and target
				globalId: vec3u,

				// tiles
				offset: vec2u,
				tileSize: vec2u,

				// settings
				seed: u32,
				bounces: u32,
				filterGlossy: f32,

				// environment
				envMap: texture_2d<f32>,
				envMapSampler: sampler,
				envMapRotation: mat3x3f,
				envMapIntensity: f32,

				background: texture_2d<f32>,
				backgroundSampler: sampler,
				backgroundRotation: mat3x3f,
				backgroundIntensity: f32,
				backgroundBlurriness: f32,

			) -> void {

				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };
				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };

				let envInfo = EnvironmentInfo(
					envMapRotation,
					envMapIntensity,
					0.0 // blur,
				);

				let backgroundInfo = EnvironmentInfo(
					backgroundRotation,
					backgroundIntensity,
					backgroundBlurriness,
				);

				// make sure we don't bleed over the edge of our tile
				if ( globalId.x >= tileSize.x || globalId.y >= tileSize.y ) {

					return;

				}

				// to screen coordinates
				let indexUV = offset + globalId.xy;
				let targetDimensions = textureDimensions( ${ params.outputTarget } );
				if ( indexUV.x >= targetDimensions.x || indexUV.y >= targetDimensions.y ) {

					return;

				}

				let uv = vec2f( indexUV ) / vec2f( targetDimensions );
				${ rngInit }( indexUV.xy, seed, 0 );

				// scene ray
				let jitteredUv = uv + ${ rand2 }( ${ RNG_INDEX_RAY_JITTER } ) / vec2f( targetDimensions );
				var ray = ${ getCameraRayFn }( jitteredUv, vec2f( targetDimensions ) );
				ray.direction = normalize( ray.direction );

				var resultColor = vec4f( 0, 0, 0, 1 );
				var throughputColor = vec3f( 1.0 );
				var minPdf = 1.0;

				for ( var bounce = 0u; bounce < bounces; bounce ++ ) {

					var hitResult: ${ raycastOutput };
					if ( ${ raycastFirstHitFn }( ray, &hitResult ) ) {

						let object = transforms[ hitResult.objectIndex ];
						var material = materials[ object.materialIndex ];

						// apply per-object colors
						material.color *= object.color.rgb;
						material.opacity *= object.color.a;

						var vertexData = ${ sampleTrianglePointFn }( hitResult.barycoord, hitResult.indices.xyz );
						vertexData.normal = normalize( transpose( object.inverseMatrixWorld ) * vertexData.normal );
						vertexData.position = object.matrixWorld * vertexData.position;

						let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * minPdf, 0.0, 1.0 ) ) * 0.5;

						let surface = ${ getSurfaceRecordFn }( material, vertexData, hitResult.side, hitResult.normal, blurRoughness );

						resultColor += vec4f( throughputColor * surface.emission, 0.0 );

						let scatterRec = ${ bsdfSampleFn }( - ray.direction, surface );

						if ( ${ isTerminatingScatterFunc }( scatterRec ) ) {

							break;

						}

						minPdf = min( minPdf, scatterRec.pdf );

						// russian roulette early out
						if ( bounce >= 3u ) {

							let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
							let rrProb = sqrt( saturate( ${ luminanceFn }( rrThroughput ) / max( ${ luminanceFn }( throughputColor ), 1e-4 ) ) );
							if ( ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb ) {

								break;

							}

							// perform sample clamping here to avoid bright pixels
							throughputColor *= min( 1.0 / rrProb, 20.0 );

						}

						throughputColor *= scatterRec.color;
						throughputColor /= scatterRec.pdf;

						// exit if our throughput is 0.0
						if ( all( throughputColor == vec3f( 0.0 ) ) ) {

							break;

						}

						// TODO: Investigate offsetting this position to not self-intersect multiple times
						// Adding + scatterRec.direction * 1e-1 seems to fix almost all the fireflies
						// However that seems like a very large distance to offset
						ray.origin = vertexData.position.xyz;
						ray.direction = scatterRec.direction;

					} else {

						let rng = ${ rand2 }( ${ RNG_INDEX_ENVIRONMENT_SAMPLE } );
						if ( bounce > 0u ) {

							resultColor += ${ sampleEnvironmentFn }( envMap, envMapSampler, envInfo, ray.direction, rng ) * vec4f( throughputColor, 0.0 );

						} else {

							resultColor = ${ sampleEnvironmentFn }( background, backgroundSampler, backgroundInfo, ray.direction, rng );

						}

						break;

					}

					${ rngNextBounce }();

				}

				let sampleCount = textureLoad( ${ params.sampleCountTarget }, indexUV ).r + 1;
				let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
				let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
				textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
				textureStore( ${ params.outputTarget }, indexUV, blendedColor );

			}`;

		super( shader( params ) );

		this.defineUniformAccessors( params );

	}

}
