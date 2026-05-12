import { globalId, sampler, storage, texture, textureStore, uniform } from 'three/tsl';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode';
import { ComputeKernel } from '../ComputeKernel';
import { isTerminatingScatterFunc, luminanceFunc, weightedAlphaBlendFn } from '../../nodes/utils.wgsl';
import { lightRecordStruct, scatterRecordStruct } from '../../nodes/structs.wgsl';
import { SOBOL_INDEX_ENVIRONMENT_SAMPLE, SOBOL_INDEX_LIGHT_INDEX, SOBOL_INDEX_RUSSIAN_ROULETTE, sobolFuncs, sobolInit } from '../../nodes/random.wgsl';
import { equirectDirectionPdfFunc, equirectUvToDirectionFunc, misHeuristicFunc, sampleEnvironmentFn } from '../../nodes/sampling.wgsl';
import { isMISWeightLightFunc, LIGHT_TYPE_ENVIRONMENT, sampleRandomLightFunc } from '../../nodes/lights.wgsl';
import { proxy } from '../../lib/nodes/NodeProxy';
import { DataTexture, Matrix3, StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { intersectionResultStruct, rayDataStruct } from './structs';

export class LogicKernel extends ComputeKernel {

	constructor() {

		const params = {

			lights: { value: null },
			lightCount: uniform( 0 ),

			seed: uniform( 0 ),
			bounces: uniform( 5 ),

			rayData: storage( new StorageBufferAttribute(), rayDataStruct ),
			rayIntersections: storage( new StorageBufferAttribute(), intersectionResultStruct ),
			shadowRayIntersections: storage( new StorageBufferAttribute(), intersectionResultStruct ),

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			envMap: texture( new DataTexture() ),
			envMapSampler: sampler( new DataTexture() ),
			envMapRotation: uniform( new Matrix3() ),
			envMapIntensity: uniform( 1 ),
			invEnvMapRotation: uniform( new Matrix3() ),

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

			iesProfiles: texture( new DataTexture() ),
			iesProfilesSampler: sampler( new DataTexture() ),

			globalId: globalId,
		};

		const lightsBuffer = proxy( 'lights.value', params );

		const fn = wgslTagFn/*wgsl*/`

			fn logic(

				// environment
				envMap: texture_2d<f32>,
				envMapSampler: sampler,
				envMapRotation: mat3x3f,
				envMapIntensity: f32,
				invEnvMapRotation: mat3x3f,

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

				iesProfiles: texture_2d_array<f32>,
				iesProfilesSampler: sampler,

				// settings
				seed: u32,
				bounces: u32,
				lightCount: u32,

				globalId: vec3u,

			) {

				let index = globalId.x;
				if ( index >= arrayLength( &${ params.rayData } ) ) {

					return;

				}

				let envMapDims = vec2f( textureDimensions( envMap ).xy );
				let envMapPixelCount = envMapDims.x * envMapDims.y;
				let lightsDenom = f32( lightCount + 1 );

				let data = &${ params.rayData }[ index ];

				let currentBounce = data.currentBounce;
				${ sobolInit }( data.pixelIndex, seed, currentBounce );

				let scatterRec = ${ scatterRecordStruct }( data.bsdf, 0.0, vec3f(0.0), data.pdf );

				var throughputColor = data.throughputColor;
				var resultColor = data.resultColor;

				var isTerminated = all( throughputColor == vec3f( 0.0 ) ) || ${ isTerminatingScatterFunc }( scatterRec );
				isTerminated = isTerminated || currentBounce >= bounces;

				if ( currentBounce >= 3 ) {

					let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
					var rrProb = ${ luminanceFunc }( rrThroughput );
					rrProb /= max( ${ luminanceFunc }( throughputColor ), 1e-4 );
					rrProb = sqrt( rrProb );
					rrProb = min( rrProb, 1.0 );
					if ( ${ sobolFuncs[ 1 ] }( ${ SOBOL_INDEX_RUSSIAN_ROULETTE } ) > rrProb ) {

						isTerminated = true;

					}

					// perform sample clamping here to avoid bright pixels
					throughputColor *= min( 1.0 / rrProb, 20.0 );
				}

				if ( ! isTerminated ) {

					if ( data.shadowRayIntersectionIndex > 0 ) {

						let lightHitResult = ${ params.shadowRayIntersections }[ data.shadowRayIntersectionIndex ];
						if ( lightHitResult.objectIndex < 0 ) {

							let mis = select( 1.0, ${ misHeuristicFunc }( data.lightPdf, data.lightBsdfPdf ), data.lightPdf > 0 );
							resultColor += vec4( throughputColor * data.lightBsdf * data.lightEmission * mis / abs( data.lightPdf ), 0.0 );

						}

					}

					let hitResult = ${ params.rayIntersections }[ data.rayIntersectionIndex ];

					throughputColor *= data.attenuation;
					resultColor += vec4( throughputColor * data.emission, 0.0 );
					throughputColor *= scatterRec.color / scatterRec.pdf;

					if ( hitResult.objectIndex >= 0 ) {

						// Sample direct light
						let lightType = ${ sobolFuncs[ 1 ] }( ${ SOBOL_INDEX_LIGHT_INDEX } );
						let lightUV = ${ sobolFuncs[ 2 ] }( ${ SOBOL_INDEX_ENVIRONMENT_SAMPLE } );
						var lightRecord: ${ lightRecordStruct };
						if ( lightType * lightsDenom > f32( lightCount ) ) {

							let v = textureSampleLevel( envMapMarginalWeights, envMapMarginalWeightsSampler, vec2( lightUV.x, 0.0 ), 0 ).x;
							let u = textureSampleLevel( envMapConditionalWeights, envMapConditionalWeightsSampler, vec2( lightUV.y, v ), 0 ).x;
							let uv = vec2( u, v );

							lightRecord.direction = normalize( ${ equirectUvToDirectionFunc }( uv ) );
							lightRecord.emission = envMapIntensity * textureSampleLevel( envMap, envMapSampler, uv, 0 ).xyz;

							let weight = envMapPixelCount * ${ luminanceFunc }( lightRecord.emission ) / totalSum;
							lightRecord.pdf = weight * ${ equirectDirectionPdfFunc }( lightRecord.direction );
							lightRecord.kind = ${ LIGHT_TYPE_ENVIRONMENT };
							lightRecord.dist = 1e20;
							lightRecord.direction = invEnvMapRotation * lightRecord.direction;

						} else {

							let lightRng = lightType * lightsDenom / f32( lightCount );
							lightRecord = ${ sampleRandomLightFunc( lightsBuffer ) }(
								lightRng, lightUV, lightCount, hitResult.position, iesProfiles, iesProfilesSampler
							);

						}

						lightRecord.pdf /= lightsDenom;

						// write out updated data

						data.throughputColor = throughputColor;
						data.resultColor = resultColor;
						data.lightDirection = lightRecord.direction;
						data.lightPdf = lightRecord.pdf * select( -1.0, 1.0, ${ isMISWeightLightFunc }( lightRecord.kind ) );
						data.lightEmission = lightRecord.emission;
						data.barycoord = hitResult.barycoord;
						data.indices = hitResult.indices;
						data.objectIndex = hitResult.objectIndex;
						data.minPdf = min( data.minPdf, scatterRec.pdf );

					} else {

						let rng = ${ sobolFuncs[ 2 ] }( ${ SOBOL_INDEX_ENVIRONMENT_SAMPLE } );
						if ( currentBounce > 0u ) {

							let envInfo = EnvironmentInfo(
								envMapRotation,
								envMapIntensity,
								0.0 // blur,
							);

							let color = ${ sampleEnvironmentFn }( envMap, envMapSampler, envInfo, data.direction, rng );

							let weight = envMapPixelCount * ${ luminanceFunc }( color.xyz ) / totalSum;
							var envPdf = weight * ${ equirectDirectionPdfFunc }( data.direction );
							envPdf /= lightsDenom;

							let mis = ${ misHeuristicFunc }( scatterRec.pdf, envPdf );
							resultColor += mis * color * vec4f( throughputColor, 0.0 );

						} else {

							let backgroundInfo = EnvironmentInfo(
								backgroundRotation,
								backgroundIntensity,
								backgroundBlurriness,
							);

							resultColor = ${ sampleEnvironmentFn }( background, backgroundSampler, backgroundInfo, data.direction, rng );

						}

						isTerminated = true;

					}

				}

				if ( isTerminated ) {

					data.objectIndex = -1;

					let indexUV = vec2u( data.pixelIndex >> 16, data.pixelIndex & 0xFFFF );

					let sampleCount = textureLoad( ${ params.sampleCountTarget }, indexUV ).r + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
					textureStore( ${ params.outputTarget }, indexUV, vec4( blendedColor.xyzw ) );

				}

			}

		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
