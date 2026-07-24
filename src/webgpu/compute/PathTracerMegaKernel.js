import { DataTexture, Matrix3, Vector2, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from './ComputeKernel.js';
import { texture, sampler, uniform, globalId, textureStore } from 'three/tsl';
import { rngInit, rngNextBounce, rand2, RNG_INDEX_RAY_JITTER, RNG_INDEX_ENVIRONMENT_SAMPLE, RNG_INDEX_DIRECT_LIGHT_SAMPLE } from '../nodes/random.wgsl.js';
import { sampleEnvironmentFn, sampleEquirectProbabilityFn, envMapDirectionPdfFn, misHeuristicFn, weightedAlphaBlendFn } from '../nodes/sampling.wgsl.js';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { isTerminatingScatterFunc } from '../nodes/utils.wgsl.js';
import { environmentInfoStruct } from '../nodes/structs.wgsl.js';

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

			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			seed: uniform( 0 ),
			bounces: uniform( 5 ),

			// settings
			misEnabled: uniform( 1, 'uint' ),

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
		const bsdfEvalPdfFn = proxyFn( 'material.value.bsdfEvalPdf', params );

		// environment resources pulled straight off the envInfo provider ( EquirectHdrInfoNode )
		const envMapNode = proxy( 'envInfo.value.mapNode', params );
		const envMapSamplerNode = proxy( 'envInfo.value.mapSampler', params );
		const envMarginalNode = proxy( 'envInfo.value.marginalNode', params );
		const envMarginalSamplerNode = proxy( 'envInfo.value.marginalSampler', params );
		const envConditionalNode = proxy( 'envInfo.value.conditionalNode', params );
		const envConditionalSamplerNode = proxy( 'envInfo.value.conditionalSampler', params );
		const envRotationNode = proxy( 'envInfo.value.rotationNode', params );
		const envIntensityNode = proxy( 'envInfo.value.intensityNode', params );
		const envBlurNode = proxy( 'envInfo.value.blurNode', params );
		const envTotalSumNode = proxy( 'envInfo.value.totalSumNode', params );

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

				// environment ( map / cdf / scalars are pulled from the envInfo provider via proxies )
				misEnabled: u32,

				background: texture_2d<f32>,
				backgroundSampler: sampler,
				backgroundRotation: mat3x3f,
				backgroundIntensity: f32,
				backgroundBlurriness: f32,

			) -> void {

				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };
				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };

				let envInfo = ${ environmentInfoStruct }(
					${ envRotationNode },
					${ envIntensityNode },
					${ envBlurNode },
					${ envTotalSumNode },
				);

				let backgroundInfo = ${ environmentInfoStruct }(
					backgroundRotation,
					backgroundIntensity,
					backgroundBlurriness,
					0.0,
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
				var bsdfPdf = 0.0; // pdf of the scatter that made the current ray; MIS-weights the env on escape
				const SHADOW_RAY_EPSILON = 1.0e-4; // shadow-ray self-intersection offset ( TODO: scene-scale dependent )

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

						let surface = ${ getSurfaceRecordFn }( material, vertexData, hitResult.side, hitResult.normal );

						resultColor += vec4f( throughputColor * surface.emission, 0.0 );

						let worldWo = - ray.direction;

						// next event estimation: importance-sample the environment, MIS-weighted against the bsdf pdf.
						// skipped when disabled or when there is no env cdf, leaving pure bsdf sampling below.
						if ( misEnabled != 0u && envInfo.totalSum > 0.0 ) {

							let envSample = ${ sampleEquirectProbabilityFn }( ${ envMarginalNode }, ${ envMarginalSamplerNode }, ${ envConditionalNode }, ${ envConditionalSamplerNode }, ${ envMapNode }, ${ envMapSamplerNode }, envInfo.totalSum, ${ rand2 }( ${ RNG_INDEX_DIRECT_LIGHT_SAMPLE } ) );

							// the sampled direction is in env-map space; rotate back to world
							let worldEnvDir = transpose( envInfo.rotation ) * envSample.direction;

							// TODO: match the WebGL path - also reject samples below the GEOMETRIC surface
							// ( dot( surf.faceNormal, worldEnvDir ) < 0 ) plus an isDirectionValid check, to avoid
							// light-leaking through normal-mapped surfaces at grazing angles. Right now only the
							// shading-normal hemisphere is guarded ( wi.z <= 0 inside bsdfEvalPdf ).
							let evalRec = ${ bsdfEvalPdfFn }( worldWo, worldEnvDir, surface );

							if ( envSample.pdf > 0.0 && evalRec.pdf > 0.0 ) {

								// opaque shadow test - the env is at infinity so any hit occludes
								let ng = normalize( vertexData.normal.xyz );
								let offsetSign = select( - 1.0, 1.0, dot( ng, worldEnvDir ) > 0.0 );
								var shadowRay = ray;
								shadowRay.origin = vertexData.position.xyz + ng * offsetSign * SHADOW_RAY_EPSILON;
								shadowRay.direction = worldEnvDir;

								var shadowHit: ${ raycastOutput };
								if ( ! ${ raycastFirstHitFn }( shadowRay, &shadowHit ) ) {

									let misW = ${ misHeuristicFn }( envSample.pdf, evalRec.pdf );
									resultColor += vec4f( throughputColor * envInfo.intensity * envSample.color * evalRec.color * misW / envSample.pdf, 0.0 );

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

						let rng = ${ rand2 }( ${ RNG_INDEX_ENVIRONMENT_SAMPLE } );
						if ( bounce > 0u ) {

							var misW = 1.0;
							if ( misEnabled != 0u && envInfo.totalSum > 0.0 ) {

								// a bsdf ray escaped to the environment - MIS-weight so the NEE contribution isn't double counted
								let envSpaceDir = envInfo.rotation * ray.direction;
								let envPdf = ${ envMapDirectionPdfFn }( ${ envMapNode }, ${ envMapSamplerNode }, envInfo.totalSum, envSpaceDir );
								misW = ${ misHeuristicFn }( bsdfPdf, envPdf );

							}

							resultColor += ${ sampleEnvironmentFn }( ${ envMapNode }, ${ envMapSamplerNode }, envInfo, ray.direction, rng ) * vec4f( throughputColor * misW, 0.0 );

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
