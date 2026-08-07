import { StorageBufferAttribute, StorageTexture, DataTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId, texture, sampler } from 'three/tsl';
import { rayQueueAtomicStruct, hitQueueStruct } from './structs.js';
import { proxy, proxyFn, wgslTagFn } from 'three-mesh-bvh/webgpu';
import { weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { isTerminatingScatterFunc, offsetRayOriginFunc } from '../../nodes/utils.wgsl.js';
import { rngInit } from '../../nodes/random.wgsl.js';

export class ProcessHitsKernel extends ComputeKernel {

	constructor( ) {

		const params = {
			bvhData: { value: null },
			material: { value: null },

			// targets
			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// settings
			smoothNormals: uniform( 1 ),
			bounces: uniform( 1 ),

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

				let objectInfo = transforms[ input.objectIndex ];
				var materialInfo = materials[ objectInfo.materialIndex ];

				// apply per-object colors
				materialInfo.color *= objectInfo.color.rgb;
				materialInfo.opacity *= objectInfo.color.a;

				let barycoord = vec3( input.barycoord, 1.0 - input.barycoord.x - input.barycoord.y );
				var vertexData = ${ sampleTrianglePointFn }( barycoord, input.indices.xyz );
				vertexData.normal = normalize( transpose( objectInfo.inverseMatrixWorld ) * vertexData.normal );
				vertexData.position = objectInfo.matrixWorld * vertexData.position;

				let surface = ${ getSurfaceRecordFn }( materialInfo, vertexData, input.side, input.normal );

				let scatterRec = ${ bsdfSampleFn }( input.view, surface );

				var resultColor = input.resultColor + vec4f( input.throughputColor * surface.emission, 0.0 );

				let isTerminated = input.currentBounce >= bounces || ${ isTerminatingScatterFunc }( scatterRec );

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
					rayQueue.elements[ index ].origin = ${ offsetRayOriginFunc }( vertexData.position.xyz, scatterRec.direction, input.normal );
					rayQueue.elements[ index ].direction = scatterRec.direction;
					rayQueue.elements[ index ].pixel = indexUV;
					rayQueue.elements[ index ].throughputColor = input.throughputColor * scatterRec.color / scatterRec.pdf;
					rayQueue.elements[ index ].currentBounce = input.currentBounce + 1;
					rayQueue.elements[ index ].resultColor = resultColor;
					rayQueue.elements[ index ].seed = input.seed;
					rayQueue.elements[ index ].bsdfPdf = scatterRec.pdf;

				}

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
