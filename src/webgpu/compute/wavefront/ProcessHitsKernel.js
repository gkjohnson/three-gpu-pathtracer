import { StorageBufferAttribute, StorageTexture, DataTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId, texture, sampler } from 'three/tsl';
import { getSurfaceRecordFunc, transmissionAttenuationFunc } from '../../nodes/material.wgsl.js';
import { hitQueueStruct, rayQueueAtomicStruct } from './structs.js';
import { proxy, proxyFn } from '../../lib/nodes/NodeProxy.js';
import { misHeuristicFunc } from '../../nodes/sampling.wgsl.js';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode.js';
import { isTerminatingScatterFunc, luminanceFunc, weightedAlphaBlendFn } from '../../nodes/utils.wgsl.js';
import { SOBOL_INDEX_RUSSIAN_ROULETTE, sobolFuncs, sobolInit } from '../../nodes/random.wgsl.js';

const FILTER_GLOSSY = 1.0;

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
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueAtomicStruct ),
			hitQueue: storage( new StorageBufferAttribute( 1, 1 ), hitQueueStruct ),

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

				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };

				// skip any rays invocations beyond the ray count
				let hitQueueCapacity = arrayLength( &hitQueue.elements );
				let hitIndex = ( globalId.x + hitQueue.start );
				if ( hitIndex >= hitQueue.end ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let input = hitQueue.elements[ hitIndex ];

				let currentBounce = input.currentBounce;
				let pixelIndex = input.pixel;
				${ sobolInit }( pixelIndex, seed, currentBounce );

				let object = transforms[ input.objectIndex ];
				var material = materials[ object.materialIndex ];

				// apply per-object colors
				material.color *= object.color.rgb;
				material.opacity *= object.color.a;

				var vertexData = ${ sampleTrianglePointFn }( input.barycoord, input.indices.xyz );
				vertexData.normal = normalize( transpose( object.inverseMatrixWorld ) * vertexData.normal );
				vertexData.position = object.matrixWorld * vertexData.position;

				let blurRoughness = sqrt( clamp( 1.0 - ${ FILTER_GLOSSY } * input.minPdf, 0.0, 1.0 ) ) * 0.5;

				let surface = ${ getSurfaceRecordFunc }(
					material, vertexData, input.side > 0.0, input.normal,
					blurRoughness, textures, textureSampler
				);

				let scatterRec = ${ bsdfSampleFn }( input.view, surface );

				var throughputColor = input.throughputColor;
				if ( input.side < 0.0 ) {
					throughputColor *= ${ transmissionAttenuationFunc }( input.hitDist, material.attenuationColor, material.attenuationDistance );
				}
				var resultColor = input.resultColor + throughputColor * surface.emission;

				if ( input.lightPdf != 0.0 ) {
					let bsdf = ${ bsdfEvalScatterFn }( input.view,  input.lightDirection, surface );
					let mis = select( 1.0, ${ misHeuristicFunc }( input.lightPdf, bsdf.pdf ), input.lightPdf > 0.0 );
					resultColor += throughputColor * bsdf.color * input.lightColor * mis / abs( input.lightPdf );
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
					let indexUV = vec2u( input.pixel >> 16, input.pixel & 0xFFFF );
					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, vec4f( resultColor, 1.0 ), 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
					textureStore( ${ params.outputTarget }, indexUV, blendedColor );

				} else {

					let rayQueueCapacity = arrayLength( &rayQueue.elements );
					let index = atomicAdd( &rayQueue.end, 1 ) % rayQueueCapacity;

					let offsetDir = input.normal * sign( dot( input.normal, scatterRec.direction ) );
					let newPoint = vertexData.position.xyz + 1e-3 * offsetDir;

					rayQueue.elements[ index ].origin = newPoint;
					rayQueue.elements[ index ].direction = scatterRec.direction;
					rayQueue.elements[ index ].pixel = pixelIndex;
					rayQueue.elements[ index ].throughputColor = throughputColor * scatterRec.color / scatterRec.pdf;
					rayQueue.elements[ index ].currentBounce = currentBounce + 1;
					rayQueue.elements[ index ].resultColor = resultColor;
					rayQueue.elements[ index ].lastPdf = scatterRec.pdf;
					rayQueue.elements[ index ].minPdf = min( scatterRec.pdf, input.minPdf );

				}

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
