import { IndirectStorageBufferAttribute, StorageTexture, DataTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId, texture, sampler } from 'three/tsl';
import { getSurfaceRecordFunc } from '../../nodes/material.wgsl.js';
import { queuedRayStruct, queuedHitStruct } from './structs.js';
import { proxy, proxyFn } from '../../lib/nodes/NodeProxy.js';
import { weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode.js';
import { isTerminatingScatterFunc } from '../../nodes/utils.wgsl.js';

export class ProcessHitsKernel extends ComputeKernel {

	constructor( rngData ) {

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
			rayQueue: storage( new IndirectStorageBufferAttribute( 1, queuedRayStruct.getLength() ), queuedRayStruct ),
			hitQueue: storage( new IndirectStorageBufferAttribute( 1, queuedHitStruct.getLength() ), queuedHitStruct ),
			queueSizes: storage( new IndirectStorageBufferAttribute( 4, 1 ), 'u32' ).toAtomic(),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			globalId: globalId,
		};

		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );
		const bsdfSampleFn = proxyFn( 'material.value.bsdfSample', params );
		const rng = rngData;

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
				let hitIndex = ( globalId.x + atomicLoad( &queueSizes[ 2 ] ) );
				if ( hitIndex >= atomicLoad( &queueSizes[ 3 ] ) ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let input = hitQueue[ hitIndex ];
				let indexUV = vec2u( input.pixel_x, input.pixel_y );

				let pixelIndex = ( indexUV.x << 16 ) | indexUV.y;
				${ rng.init }( pixelIndex, seed, input.currentBounce );

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

				let resultColor = input.resultColor + vec4f( input.throughputColor * surface.emission, 0.0 );

				let isTerminated = input.currentBounce >= bounces || ${ isTerminatingScatterFunc }( scatterRec );

				if ( isTerminated ) {

					// terminate ray, write color
					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor, resultColor, 1.0 / f32( sampleCount ) );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
					textureStore( ${ params.outputTarget }, indexUV, blendedColor );

				} else {

					let rayQueueCapacity = arrayLength( rayQueue );
					let index = atomicAdd( &queueSizes[ 1 ], 1 ) % rayQueueCapacity;
					rayQueue[ index ].origin = vertexData.position.xyz;
					rayQueue[ index ].direction = scatterRec.direction;
					rayQueue[ index ].pixel = indexUV;
					rayQueue[ index ].throughputColor = input.throughputColor * scatterRec.color / scatterRec.pdf;
					rayQueue[ index ].currentBounce = input.currentBounce + 1;
					rayQueue[ index ].resultColor = resultColor;

				}

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
