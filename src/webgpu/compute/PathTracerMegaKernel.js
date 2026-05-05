import { DataTexture, Matrix3, Matrix4, Vector2, StorageTexture, StorageBufferAttribute } from 'three/webgpu';
import { ndcToCameraRay } from '../lib/wgsl/common.wgsl.js';
import { ComputeKernel } from './ComputeKernel.js';
import { texture, sampler, uniform, globalId, textureStore, storage } from 'three/tsl';
import { sobolInit, sobolFuncs, SOBOL_INDEX_RAY_JITTER, SOBOL_INDEX_ENVIRONMENT_SAMPLE, SOBOL_INDEX_RUSSIAN_ROULETTE, SOBOL_INDEX_LIGHT_INDEX } from '../nodes/random.wgsl.js';
import { getSurfaceRecordFunc } from '../nodes/material.wgsl.js';
import { equirectDirectionPdfFunc, equirectUvToDirectionFunc, misHeuristicFunc, sampleEnvironmentFn } from '../nodes/sampling.wgsl.js';
import { proxy, proxyFn } from '../lib/nodes/NodeProxy.js';
import { wgslTagFn } from '../lib/nodes/WGSLTagFnNode.js';
import { isTerminatingScatterFunc, luminanceFunc, weightedAlphaBlendFn } from '../nodes/utils.wgsl.js';
import { rayStruct } from '../lib/wgsl/structs.wgsl.js';
import { lightRecordStruct, lightStruct } from '../nodes/structs.wgsl.js';
import { LIGHT_TYPE_ENVIRONMENT, sampleRandomLightFunc, intersectAreaLightAtIndexFunc, isMISWeightLightFunc } from '../nodes/lights.wgsl.js';

export class PathTracerMegaKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			lights: { value: null },
			material: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			offset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			seed: uniform( 0 ),
			bounces: uniform( 5 ),

			// transforms
			inverseProjectionMatrix: uniform( new Matrix4() ),
			cameraToModelMatrix: uniform( new Matrix4() ),

			// environment
			envMap: texture( new DataTexture() ),
			envMapSampler: sampler( new DataTexture() ),
			envMapRotation: uniform( new Matrix3() ),
			envMapIntensity: uniform( 1 ),

			envMapMarginalWeights: texture( new DataTexture() ),
			envMapMarginalWeightsSampler: sampler( new DataTexture() ),

			envMapConditionalWeights: texture( new DataTexture() ),
			envMapConditionalWeightsSampler: sampler( new DataTexture() ),

			totalSum: uniform( 0 ),

			background: texture( new DataTexture() ),
			backgroundSampler: sampler( new DataTexture() ),
			backgroundRotation: uniform( new Matrix3() ),
			backgroundIntensity: uniform( 1 ),
			backgroundBlurriness: uniform( 0 ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			iesProfiles: texture( new DataTexture() ),
			iesProfilesSampler: sampler( new DataTexture() ),

			lightCount: uniform( 0 ),

			// compute variables
			globalId: globalId,
		};

		const lightsBuffer = proxy( 'lights.value', params );
		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxyFn( 'bvhData.value.fns.raycastFirstHit', params );
		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const bsdfEvalScatterFn = proxyFn( 'material.value.bsdfEvalScatter', params );

		const shader = wgslTagFn/* wgsl */`

			fn compute(

				// indices and target
				globalId: vec3u,

				// tiles
				offset: vec2u,
				tileSize: vec2u,

				// settings
				inverseProjectionMatrix: mat4x4f,
				cameraToModelMatrix: mat4x4f,
				seed: u32,
				bounces: u32,

				// environment
				envMap: texture_2d<f32>,
				envMapSampler: sampler,
				envMapRotation: mat3x3f,
				envMapIntensity: f32,

				envMapMarginalWeights: texture_2d<f32>,
				envMapMarginalWeightsSampler: sampler,

				envMapConditionalWeights: texture_2d<f32>,
				envMapConditionalWeightsSampler: sampler,

				totalSum: f32,

				background: texture_2d<f32>,
				backgroundSampler: sampler,
				backgroundRotation: mat3x3f,
				backgroundIntensity: f32,
				backgroundBlurriness: f32,

				textures: texture_2d_array<f32>,
				textureSampler: sampler,

				iesProfiles: texture_2d_array<f32>,
				iesProfilesSampler: sampler,

				lightCount: u32,

			) -> void {

				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };
				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };
				let lights = &${ lightsBuffer };

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
				let ndc = uv * 2.0 - vec2f( 1.0 );

				let pixelIndex = ( indexUV.x << 16 ) | indexUV.y;
				${ sobolInit }( pixelIndex, seed, 0 );

				let lightsDenom = f32( max( lightCount, 1 ) );
				// scene ray
				var jitter = 2.0 * ${ sobolFuncs[ 2 ] }( ${ SOBOL_INDEX_RAY_JITTER } ) / vec2f( targetDimensions.xy );
				var ray = ${ ndcToCameraRay }( ndc + jitter, cameraToModelMatrix * inverseProjectionMatrix );
				ray.direction = normalize( ray.direction );

				var resultColor = vec4f( 0, 0, 0, 1 );
				var throughputColor = vec3f( 1.0 );
				var lastPdf = 0.0;

				for ( var bounce = 0u; bounce < bounces; bounce ++ ) {

					${ sobolInit }( pixelIndex, seed, bounce );

					var hitResult: ${ raycastOutput };
					let didHit = ${ raycastFirstHitFn }( ray, &hitResult );

					// Forward sampling of area lights
					if ( bounce > 0u ) {

						let lightDist = select( 1e20, hitResult.dist, didHit );
						for ( var i = 0u; i < lightCount; i ++ ) {

							var testLightRec: ${ lightRecordStruct };
							if ( ${ intersectAreaLightAtIndexFunc( lightsBuffer ) }( i, ray, &testLightRec ) ) {

								if ( testLightRec.dist < lightDist ) {

									testLightRec.pdf /= lightsDenom;
									let mis = ${ misHeuristicFunc }( lastPdf, testLightRec.pdf );
									resultColor += vec4( throughputColor * testLightRec.emission * mis, 0.0 );

								}

							}

						}

					}

					if ( didHit ) {

						let object = transforms[ hitResult.objectIndex ];
						var material = materials[ object.materialIndex ];

						// apply per-object colors
						material.color *= object.color.rgb;
						material.opacity *= object.color.a;

						var vertexData = ${ sampleTrianglePointFn }( hitResult.barycoord, hitResult.indices.xyz );
						vertexData.normal = normalize( transpose( object.inverseMatrixWorld ) * vertexData.normal );
						vertexData.position = object.matrixWorld * vertexData.position;

						let surface = ${ getSurfaceRecordFunc }( material, vertexData, hitResult.side, hitResult.normal, textures, textureSampler );

						resultColor += vec4f( throughputColor * surface.emission, 0.0 );

						let scatterRec = ${ bsdfSampleFn }( - ray.direction, surface );

						if ( ${ isTerminatingScatterFunc }( scatterRec ) ) {

							break;

						}

						// TODO: Investigate offsetting this position to not self-intersect multiple times
						// Adding + scatterRec.direction * 1e-1 seems to fix almost all the fireflies
						// However that seems like a very large distance to offset
						let newPoint = vertexData.position.xyz;

						// TODO: forward sample area lights?
						// Direct light contribution

						let lightType = ${ sobolFuncs[ 1 ] }( ${ SOBOL_INDEX_LIGHT_INDEX } );
						let lightUV = ${ sobolFuncs[ 2 ] }( ${ SOBOL_INDEX_ENVIRONMENT_SAMPLE } );
						var lightRecord: ${ lightRecordStruct };
						if ( lightType * ( f32( lightCount ) + 1.0 ) > f32( lightCount ) ) {

							let v = textureSampleLevel( envMapMarginalWeights, envMapMarginalWeightsSampler, vec2( lightUV.x, 0.0 ), 0 ).x;
							let u = textureSampleLevel( envMapConditionalWeights, envMapConditionalWeightsSampler, vec2( lightUV.y, v ), 0 ).x;
							let uv = vec2( u, v );

							lightRecord.direction = normalize( ${ equirectUvToDirectionFunc }( uv ) );
							lightRecord.emission = envInfo.intensity * textureSampleLevel( envMap, envMapSampler, uv, 0 ).xyz;

							let resolution = textureDimensions( envMap ).xy;
							let weight = f32( resolution.x * resolution.y ) * ${ luminanceFunc }( lightRecord.emission ) / totalSum;
							lightRecord.pdf = weight * ${ equirectDirectionPdfFunc }( lightRecord.direction );
							lightRecord.kind = ${ LIGHT_TYPE_ENVIRONMENT };

						} else {

							let lightRng = lightType * ( f32( lightCount ) + 1.0 ) / f32( lightCount );
							lightRecord = ${ sampleRandomLightFunc( lightsBuffer ) }(
								lightRng, lightUV, lightCount, newPoint, iesProfiles, iesProfilesSampler
							);

						}

						lightRecord.pdf /= lightsDenom;

						// Light portal?
						if ( dot( lightRecord.direction, surface.faceNormal ) < 0.0 ) {

							lightRecord.pdf = 0.0;

						}

						if ( lightRecord.pdf > 0.0 ) {
							var envRay: ${ rayStruct };
							envRay.direction = lightRecord.direction;
							envRay.origin = newPoint;
							var envHitResult: ${ raycastOutput };
							if ( ! ${ raycastFirstHitFn }( envRay, &envHitResult ) || envHitResult.dist > lightRecord.dist ) {

								let bsdf = ${ bsdfEvalScatterFn }( -ray.direction, envRay.direction, surface );
								let mis = select( 1.0, ${ misHeuristicFunc }( lightRecord.pdf, bsdf.pdf ), ${ isMISWeightLightFunc }( lightRecord.kind ));
								resultColor += vec4( throughputColor * bsdf.color * lightRecord.emission * mis / lightRecord.pdf, 0.0 );

							}

						}

						// Direct light contribution end

						// russian roulette path termination
						// https://blogs.autodesk.com/media-and-entertainment/wp-content/uploads/sites/162/physically_based_shader_design_in_arnold.pdf						uint minBounces = 3u;
						if ( bounce >= 3 ) {
							var rrProb = ${ luminanceFunc }( throughputColor * scatterRec.color / scatterRec.pdf );
							rrProb /= ${ luminanceFunc }( throughputColor );
							rrProb = sqrt( rrProb );
							rrProb = min( rrProb, 1.0 );
							if ( ${ sobolFuncs[ 1 ] }( ${ SOBOL_INDEX_RUSSIAN_ROULETTE } ) > rrProb ) {

								break;

							}

							// perform sample clamping here to avoid bright pixels
							throughputColor *= min( 1.0 / rrProb, 20.0 );
						}


						throughputColor *= scatterRec.color / scatterRec.pdf;

						ray.origin = newPoint;
						ray.direction = scatterRec.direction;
						lastPdf = scatterRec.pdf;

					} else {

						let rng = ${ sobolFuncs[ 2 ] }( ${ SOBOL_INDEX_ENVIRONMENT_SAMPLE } );
						if ( bounce > 0u ) {

							let color = ${ sampleEnvironmentFn }( envMap, envMapSampler, envInfo, ray.direction, rng );

							let resolution = textureDimensions( envMap ).xy;
							let weight = f32( resolution.x * resolution.y ) * ${ luminanceFunc }( color.xyz ) / totalSum;
							var envPdf = weight * ${ equirectDirectionPdfFunc }( ray.direction );

							let mis = ${ misHeuristicFunc }( lastPdf, envPdf );
							resultColor += mis * color * vec4f( throughputColor, 0.0 );

						} else {

							resultColor = ${ sampleEnvironmentFn }( background, backgroundSampler, backgroundInfo, ray.direction, rng );

						}

						break;

					}

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
