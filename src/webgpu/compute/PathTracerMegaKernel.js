import { DataTexture, Vector2, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { texture, sampler, uniform, globalId, textureStore } from 'three/tsl';
import { rngInit, rngNextBounce, rand2, RNG_INDEX_RAY_JITTER, RNG_INDEX_BACKGROUND_SAMPLE, RNG_INDEX_DIRECT_LIGHT_SAMPLE } from '../nodes/random.wgsl.js';
import { misHeuristicFn, weightedAlphaBlendFn } from '../nodes/sampling.wgsl.js';
import { proxy, proxyFn, wgslTagFn, rayStruct } from 'three-mesh-bvh/webgpu';
import { isTerminatingScatterFunc } from '../nodes/utils.wgsl.js';

export class PathTracerMegaKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			material: { value: null },
			envInfo: { value: null },

			// targets
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// tiles
			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),

			// settings
			seed: uniform( 0 ),
			bounces: uniform( 5 ),
			misEnabled: uniform( 1, 'uint' ),

			backgroundInfo: { value: null },

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
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );

		// environment resources
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );
		const sampleEnvColor = proxy( 'envInfo.value.sampleColor', params );
		const sampleEnvDir = proxy( 'envInfo.value.sampleDir', params );
		const getEnvDirPdf = proxy( 'envInfo.value.getDirPdf', params );
		const sampleBackground = proxy( 'backgroundInfo.value.sampleColor', params );

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
				misEnabled: u32,

			) -> void {

				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };
				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };

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
				var bsdfPdf = 0.0;

				for ( var bounce = 0u; bounce < bounces; bounce ++ ) {

					var hitResult: ${ raycastOutput };
					if ( ${ raycastFirstHitFn }( ray, &hitResult ) ) {

						let objectInfo = transforms[ hitResult.objectIndex ];
						var materialInfo = materials[ objectInfo.materialIndex ];

						// apply per-object colors
						materialInfo.color *= objectInfo.color.rgb;
						materialInfo.opacity *= objectInfo.color.a;

						var vertexData = ${ sampleTrianglePointFn }( hitResult.barycoord, hitResult.indices.xyz );
						vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
						vertexData.position = objectInfo.matrixWorld * vertexData.position;

						let surface = ${ getSurfaceRecordFn }( materialInfo, vertexData, hitResult.side, hitResult.normal );

						resultColor += vec4f( throughputColor * surface.emission, 0.0 );

						let worldWo = - ray.direction;

						// next event estimation
						// importance-sample the environment, MIS-weighted against the bsdf pdf.
						if ( misEnabled != 0u && ${ envTotalSumNode } > 0.0 ) {

							let envSample = ${ sampleEnvDir }( ${ rand2 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } ) );

							// TODO: do we need to guard against other forms of invalid rays? Eg below the surface?
							let evalRec = ${ bsdfEvalPdfFn }( worldWo, envSample.direction, surface );
							if ( envSample.pdf > 0.0 && evalRec.pdf > 0.0 ) {

								// TODO: is an offset needed here?
								var shadowRay: ${ rayStruct };
								shadowRay.origin = vertexData.position.xyz;
								shadowRay.direction = envSample.direction;

								var shadowHit: ${ raycastOutput };
								if ( ! ${ raycastFirstHitFn }( shadowRay, &shadowHit ) ) {

									let misWeight = ${ misHeuristicFn }( envSample.pdf, evalRec.pdf );
									resultColor += vec4f( throughputColor * envSample.color * evalRec.color * misWeight / envSample.pdf, 0.0 );

								}

							}

						}

						let scatterRec = ${ bsdfSampleFn }( worldWo, surface );
						if ( ${ isTerminatingScatterFunc }( scatterRec ) ) {

							break;

						}

						throughputColor *= scatterRec.color;
						throughputColor /= scatterRec.pdf;
						bsdfPdf = scatterRec.pdf;

						// TODO: Investigate offsetting this position to not self-intersect multiple times
						// Adding + scatterRec.direction * 1e-1 seems to fix almost all the fireflies
						// However that seems like a very large distance to offset
						ray.origin = vertexData.position.xyz;
						ray.direction = scatterRec.direction;

					} else {

						if ( bounce > 0u ) {

							var misWeight = 1.0;
							if ( misEnabled != 0u && ${ envTotalSumNode } > 0.0 ) {

								let envPdf = ${ getEnvDirPdf }( ray.direction );
								misWeight = ${ misHeuristicFn }( bsdfPdf, envPdf );

							}

							resultColor += ${ sampleEnvColor }( ray.direction ) * vec4f( throughputColor * misWeight, 0.0 );

						} else {

							let rng = ${ rand2 }( ${ RNG_INDEX_BACKGROUND_SAMPLE } );
							resultColor = ${ sampleBackground }( ray.direction, rng );

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
