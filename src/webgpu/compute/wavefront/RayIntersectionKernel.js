import { DataTexture, Matrix3, StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, texture, sampler, storage, textureStore, globalId, localId, uint } from 'three/tsl';
import { SOBOL_INDEX_ENVIRONMENT_SAMPLE, sobolFuncs, sobolInit } from '../../nodes/random.wgsl.js';
import { rayQueueStruct, hitQueueAtomicStruct } from './structs.js';
import { proxy } from '../../lib/nodes/NodeProxy.js';
import { equirectDirectionPdfFunc, misHeuristicFunc, sampleEnvironmentFn } from '../../nodes/sampling.wgsl.js';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode.js';
import { luminanceFunc, weightedAlphaBlendFn } from '../../nodes/utils.wgsl.js';
import { lightRecordStruct } from '../../nodes/structs.wgsl.js';
import { intersectAreaLightAtIndexFunc } from '../../nodes/lights.wgsl.js';

export class RayIntersectionKernel extends ComputeKernel {

	constructor() {

		const params = {
			bvhData: { value: null },
			lights: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// rays
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueStruct ),
			hitQueue: storage( new StorageBufferAttribute( 1, 1 ), hitQueueAtomicStruct ),

			seed: uniform( 0 ),
			totalSum: uniform( 0 ),
			lightCount: uniform( 0 ),

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

			globalId: globalId,
			localId: localId,
		};

		const raycastOutput = proxy( 'bvhData.value.fns.raycastFirstHit.outputType', params );
		const raycastFirstHitFn = proxy( 'bvhData.value.fns.raycastFirstHit', params );
		const lightsBuffer = proxy( 'lights.value', params );
		const threadIdNode = uint( 0 ).toVar( 'g_threadId' );

		const fn = wgslTagFn /* wgsl */`

			fn compute(
				seed: u32,

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

				totalSum: f32,

				lightCount: u32,

				globalId: vec3u,
				localId: vec3u
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let hitQueue = &${ params.hitQueue };

				let lightsDenom = f32( max( lightCount, 1 ) );

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

				// skip any rays invocations beyond the ray count
				let queueCapacity = arrayLength( &rayQueue.elements );
				let rayIndex = ( globalId.x + rayQueue.start );
				if ( rayIndex >= rayQueue.end ) {

					return;

				}
				// TODO: tie this to actual workgroup size
				${ threadIdNode } = localId.x;

				// get the ray info
				let input = rayQueue.elements[ rayIndex % queueCapacity ];
				let indexUV = input.pixel;

				let pixelIndex = ( indexUV.x << 16 ) | indexUV.y;
				${ sobolInit }( pixelIndex, seed, input.currentBounce );

				// run intersection
				let ray = Ray( input.origin, input.direction );
				var hitResult: ${ raycastOutput };
				let didHit = ${ raycastFirstHitFn }( ray, &hitResult );

				// Forward sampling of area lights
				var resultColor = vec4f( input.resultColor, 1.0 );
				if ( input.currentBounce > 0u ) {

					let lightDist = select( 1e20, hitResult.dist, didHit );
					for ( var i = 0u; i < lightCount; i ++ ) {

						var testLightRec: ${ lightRecordStruct };
						if ( ${ intersectAreaLightAtIndexFunc( lightsBuffer ) }( i, ray, &testLightRec ) ) {

							if ( testLightRec.dist < lightDist ) {

								testLightRec.pdf /= lightsDenom;
								let mis = ${ misHeuristicFunc }( input.lastPdf, testLightRec.pdf );
								resultColor += vec4f( input.throughputColor * testLightRec.emission * mis, 0.0 );

							}

						}

					}

				}

				if ( didHit ) {

					// TODO: we process all of these materials immediately to push to the hit queue
					let index = atomicAdd( &hitQueue.end, 1 );
					hitQueue.elements[ index ].view = - input.direction;
					hitQueue.elements[ index ].indices = hitResult.indices.xyz;
					hitQueue.elements[ index ].barycoord = hitResult.barycoord;
					hitQueue.elements[ index ].normal = hitResult.normal.xyz;
					hitQueue.elements[ index ].side = hitResult.side;
					hitQueue.elements[ index ].pixel_x = indexUV.x;
					hitQueue.elements[ index ].pixel_y = indexUV.y;
					hitQueue.elements[ index ].objectIndex = hitResult.objectIndex;
					hitQueue.elements[ index ].throughputColor = input.throughputColor;
					hitQueue.elements[ index ].currentBounce = input.currentBounce;
					hitQueue.elements[ index ].resultColor = resultColor.xyz;
					hitQueue.elements[ index ].lightPdf = 0.0;
					hitQueue.elements[ index ].hitDist = hitResult.dist;
					hitQueue.elements[ index ].minPdf = input.minPdf;

				} else {

					let rng = ${ sobolFuncs[ 2 ] }( ${ SOBOL_INDEX_ENVIRONMENT_SAMPLE } );
					if ( input.currentBounce > 0u ) {

						let color = ${ sampleEnvironmentFn }( envMap, envMapSampler, envInfo, ray.direction, rng );

						let resolution = textureDimensions( envMap ).xy;
						let weight = f32( resolution.x * resolution.y ) * ${ luminanceFunc }( color.xyz ) / totalSum;
						var envPdf = weight * ${ equirectDirectionPdfFunc }( ray.direction );

						let mis = ${ misHeuristicFunc }( input.lastPdf, envPdf );
						resultColor += mis * color * vec4f( input.throughputColor, 0.0 );

					} else {

						resultColor = ${ sampleEnvironmentFn }( background, backgroundSampler, backgroundInfo, input.direction, rng );

					}

					let ACTIVE_FLAG = 0xF0000000u;
					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
					textureStore( ${ params.outputTarget }, indexUV, blendedColor );

				}

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
