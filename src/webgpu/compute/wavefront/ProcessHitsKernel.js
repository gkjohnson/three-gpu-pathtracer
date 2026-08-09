import { StorageBufferAttribute, StorageTexture, DataTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId, texture, sampler } from 'three/tsl';
import { rayQueueAtomicStruct, hitQueueStruct, RAY_FLAG_FULLY_TRANSMISSIVE } from './structs.js';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { weightedAlphaBlendFn, luminanceFn } from '../../nodes/sampling.wgsl.js';
import { isTerminatingScatterFunc } from '../../nodes/utils.wgsl.js';
import { rngInit, rand1, RNG_INDEX_RUSSIAN_ROULETTE } from '../../nodes/random.wgsl.js';
import { transmissionAttenuationFunc } from '../../nodes/material.wgsl.js';
import { SCATTER_RECORD_FLAG_TRANSMISSIVE } from '../../nodes/structs.wgsl.js';

export class ProcessHitsKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			material: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// settings
			smoothNormals: uniform( 1 ),
			bounces: uniform( 1 ),
			filterGlossy: uniform( 1 ),

			// rays
			rayQueue: storage( new StorageBufferAttribute( 1, 1 ), rayQueueAtomicStruct ),
			hitQueue: storage( new StorageBufferAttribute( 1, 1 ), hitQueueStruct ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			globalId: globalId,
		};

		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const getSurfaceRecordFn = proxyFn( 'bvhData.value.fns.getSurfaceRecord', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				// settings
				smoothNormals: u32,
				bounces: u32,
				filterGlossy: f32,

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
				let indexUV = vec2u( input.pixel_x, input.pixel_y );
				${ rngInit }( indexUV.xy, input.seed, input.currentBounce );

				let object = transforms[ input.objectIndex ];
				var material = materials[ object.materialIndex ];

				// apply per-object colors
				material.color *= object.color.rgb;
				material.opacity *= object.color.a;

				let barycoord = vec3( input.barycoord, 1.0 - input.barycoord.x - input.barycoord.y );
				var vertexData = ${ sampleTrianglePointFn }( barycoord, input.indices.xyz );
				vertexData.normal = normalize( transpose( object.inverseMatrixWorld ) * vertexData.normal );
				vertexData.position = object.matrixWorld * vertexData.position;

				// blur glossy surfaces after low-probability bounces to suppress fireflies,
				// from the Cycles "filter glossy" approach in integrator/surface_shader.h
				// The smallest pdf seen along the path for the glossy filter is tracked below
				let blurRoughness = sqrt( clamp( 1.0 - filterGlossy * input.minPdf, 0.0, 1.0 ) ) * 0.5;

				let surface = ${ getSurfaceRecordFn }( material, vertexData, input.side, input.normal, input.view, blurRoughness );

				var throughputColor = input.throughputColor;

				// attenuate the light transmitted through the volume when exiting a backface
				if ( input.side < 0.0 ) {

					throughputColor *= ${ transmissionAttenuationFunc }( input.dist, material.attenuationColor, material.attenuationDistance );

				}

				let scatterRec = ${ bsdfSampleFn }( input.view, surface );

				let resultColor = input.resultColor + vec4f( throughputColor * surface.emission, 0.0 );

				var isTerminated = input.currentBounce >= bounces || ${ isTerminatingScatterFunc }( scatterRec );

				// russian roulette early out
				if ( ! isTerminated && input.currentBounce >= 3u ) {

					let rrThroughput = throughputColor * scatterRec.color / scatterRec.pdf;
					let rrProb = sqrt( saturate( ${ luminanceFn }( rrThroughput ) / max( ${ luminanceFn }( throughputColor ), 1e-4 ) ) );
					isTerminated = ${ rand1 }( ${ RNG_INDEX_RUSSIAN_ROULETTE } ) > rrProb;

					// perform sample clamping here to avoid bright pixels
					throughputColor *= min( 1.0 / rrProb, 20.0 );

				}

				if ( ! isTerminated ) {

					// only divide by the pdf if this ray is valid
					throughputColor *= scatterRec.color / scatterRec.pdf;

					// exit if our throughput is 0.0
					isTerminated = all( throughputColor == vec3f( 0.0 ) );

				}

				if ( isTerminated ) {

					// terminate ray, write color
					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
					textureStore( ${ params.outputTarget }, indexUV, blendedColor );

				} else {

					let rayQueueCapacity = arrayLength( &rayQueue.elements );
					let index = atomicAdd( &rayQueue.end, 1 ) % rayQueueCapacity;
					rayQueue.elements[ index ].origin = vertexData.position.xyz;
					rayQueue.elements[ index ].direction = scatterRec.direction;
					rayQueue.elements[ index ].pixel = indexUV;
					rayQueue.elements[ index ].throughputColor = throughputColor;
					rayQueue.elements[ index ].currentBounce = input.currentBounce + 1;
					rayQueue.elements[ index ].resultColor = resultColor;
					rayQueue.elements[ index ].seed = input.seed;
					rayQueue.elements[ index ].flags = select(
						input.flags & ~${ RAY_FLAG_FULLY_TRANSMISSIVE }u,
						input.flags,
						( scatterRec.flags & ${ SCATTER_RECORD_FLAG_TRANSMISSIVE }u ) > 0
					);
					rayQueue.elements[ index ].minPdf = min( scatterRec.pdf, input.minPdf );

				}

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
