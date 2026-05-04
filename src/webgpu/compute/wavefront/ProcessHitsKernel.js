import { StorageBufferAttribute, StorageTexture, DataTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId, texture, sampler } from 'three/tsl';
import { getSurfaceRecordFunc } from '../../nodes/material.wgsl.js';
import { queuedRayStruct, queuedHitStruct, queueSizesStructHitFree } from './structs.js';
import { proxy, proxyFn } from '../../lib/nodes/NodeProxy.js';
import { misHeuristicFunc } from '../../nodes/sampling.wgsl.js';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode.js';
import { isTerminatingScatterFunc, luminanceFunc, weightedAlphaBlendFn } from '../../nodes/utils.wgsl.js';
import { SOBOL_INDEX_RUSSIAN_ROULETTE, sobolFuncs, sobolInit } from '../../nodes/random.wgsl.js';

export class ProcessHitsKernel extends ComputeKernel {

	constructor() {

		const params = {
			bvhData: { value: null },
			material: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// settings
			smoothNormals: uniform( 1 ),
			bounces: uniform( 1 ),
			seed: uniform( 0 ),

			// rays
			rayQueue: storage( new StorageBufferAttribute( 1, queuedRayStruct.getLength() ), queuedRayStruct ),
			hitQueue: storage( new StorageBufferAttribute( 1, queuedHitStruct.getLength() ), queuedHitStruct ),
			queueSizes: storage( new StorageBufferAttribute( 1, queueSizesStructHitFree.getLength() ), queueSizesStructHitFree ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			globalId: globalId,
		};

		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const bsdfEvalScatterFn = proxyFn( 'material.value.bsdfEvalScatter', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				seed: u32,

				// settings
				smoothNormals: u32,
				bounces: u32,

				textures: texture_2d_array<f32>,
				textureSampler: sampler,

				globalId: vec3u
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let hitQueue = &${ params.hitQueue };
				let queueSizes = &${ params.queueSizes };

				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };

				// skip any rays invocations beyond the ray count
				let hitQueueCapacity = arrayLength( hitQueue );
				let hitIndex = ( globalId.x + queueSizes.hitQueueStart );
				if ( hitIndex >= queueSizes.hitQueueEnd ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let input = hitQueue[ hitIndex ];
				let indexUV = vec2u( input.pixel_x, input.pixel_y );

				let currentBounce = input.currentBounce;
				let pixelIndex = ( indexUV.x << 16 ) | indexUV.y;
				${ sobolInit }( pixelIndex, seed, currentBounce );

				let object = transforms[ input.objectIndex ];
				var material = materials[ object.materialIndex ];

				// apply per-object colors
				material.color *= object.color.rgb;
				material.opacity *= object.color.a;

				var vertexData = ${ sampleTrianglePointFn }( input.barycoord, input.indices.xyz );
				vertexData.normal = normalize( transpose( object.inverseMatrixWorld ) * vertexData.normal );
				vertexData.position = object.matrixWorld * vertexData.position;

				let surface = ${ getSurfaceRecordFunc }( material, vertexData, input.side, input.normal, textures, textureSampler );

				let scatterRec = ${ bsdfSampleFn }( input.view, surface );

				var throughputColor = input.throughputColor;
				var resultColor = input.resultColor + vec4f( throughputColor * surface.emission, 0.0 );

				if ( input.lightPdf != 0.0 ) {
					let bsdf = ${ bsdfEvalScatterFn }( input.view,  input.lightDirection, surface );
					let mis = ${ misHeuristicFunc }( input.lightPdf, bsdf.pdf ); // select( 1.0, misHeuristic( input.lightPdf, lightScatterRec.pdf ), input.lightPdf > 0.0 );
					resultColor += vec4( throughputColor * bsdf.color * input.lightColor * mis / input.lightPdf, 0.0 );
				}

				var isTerminated = currentBounce >= bounces || ${ isTerminatingScatterFunc }( scatterRec );

				// russian roulette path termination
				// https://blogs.autodesk.com/media-and-entertainment/wp-content/uploads/sites/162/physically_based_shader_design_in_arnold.pdf						uint minBounces = 3u;
				if ( currentBounce >= 3 ) {
					var rrProb = ${ luminanceFunc }( throughputColor * scatterRec.color / scatterRec.pdf );
					rrProb /= ${ luminanceFunc }( throughputColor );
					rrProb = sqrt( rrProb );
					rrProb = min( rrProb, 1.0 );
					if ( ${ sobolFuncs[ 1 ] }( ${ SOBOL_INDEX_RUSSIAN_ROULETTE } ) > rrProb ) {

						isTerminated = true;

					} else {

						// perform sample clamping here to avoid bright pixels
						throughputColor *= min( 1.0 / rrProb, 20.0 );

					}
				}

				if ( isTerminated ) {

					// terminate ray, write color
					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
					textureStore( ${ params.outputTarget }, indexUV, blendedColor );

				} else {

					let rayQueueCapacity = arrayLength( rayQueue );
					let index = atomicAdd( &queueSizes.rayQueueEnd, 1 ) % rayQueueCapacity;
					rayQueue[ index ].origin = vertexData.position.xyz;
					rayQueue[ index ].direction = scatterRec.direction;
					rayQueue[ index ].pixel = indexUV;
					rayQueue[ index ].throughputColor = throughputColor * scatterRec.color / scatterRec.pdf;
					rayQueue[ index ].currentBounce = currentBounce + 1;
					rayQueue[ index ].resultColor = resultColor;
					rayQueue[ index ].lastPdf = scatterRec.pdf;

				}

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
