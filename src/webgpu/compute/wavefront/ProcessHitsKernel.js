import { IndirectStorageBufferAttribute, StorageTexture, DataTexture } from 'three/webgpu';
import { ComputeKernel } from '../ComputeKernel.js';
import { uniform, storage, textureStore, globalId, texture, sampler } from 'three/tsl';
import { getSurfaceRecordFunc, lambertBsdfFunc } from '../../nodes/material.wgsl.js';
import { queuedRayStruct, queuedHitStruct } from './structs.js';
import { proxy, proxyFn } from '../../lib/nodes/NodeProxy.js';
import { weightedAlphaBlendFn } from '../../nodes/sampling.wgsl.js';
import { wgslTagFn } from '../../lib/nodes/WGSLTagFnNode.js';
import { packCompensationFn, unpackCompensationFn } from '../../nodes/f16packing.wgsl.js';

export class ProcessHitsKernel extends ComputeKernel {

	constructor() {

		const params = {
			bvhData: { value: null },

			prevOutputTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadOnly(),
			outputTarget: textureStore( new StorageTexture( 1, 1 ) ).toWriteOnly(),
			sampleCountTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),
			compensationTarget: textureStore( new StorageTexture( 1, 1 ) ).toReadWrite(),

			// settings
			smoothNormals: uniform( 1 ),
			bounces: uniform( 1 ),

			// rays
			rayQueue: storage( new IndirectStorageBufferAttribute( 1, queuedRayStruct.getLength() ), queuedRayStruct ),
			rayQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ).toAtomic(),

			hitQueue: storage( new IndirectStorageBufferAttribute( 1, queuedHitStruct.getLength() ), queuedHitStruct ),
			hitQueueSize: storage( new IndirectStorageBufferAttribute( 2, 1 ), 'u32' ),

			textures: texture( new DataTexture() ),
			textureSampler: sampler( new DataTexture() ),

			globalId: globalId,
		};

		const sampleTrianglePointFn = proxyFn( 'bvhData.value.fns.sampleTrianglePoint', params );

		const fn = wgslTagFn/* wgsl */`

			fn compute(
				// settings
				smoothNormals: u32,
				bounces: u32,

				textures: texture_2d_array<f32>,
				textureSampler: sampler,

				globalId: vec3u
			) -> void {

				let rayQueue = &${ params.rayQueue };
				let rayQueueSize = &${ params.rayQueueSize };

				let hitQueue = &${ params.hitQueue };
				let hitQueueSize = &${ params.hitQueueSize };

				let materials = &${ proxy( 'bvhData.value.storage.materials', params ) };
				let transforms = &${ proxy( 'bvhData.value.storage.transforms', params ) };

				// skip any rays invocations beyond the ray count
				let hitQueueCapacity = arrayLength( hitQueue );
				let hitIndex = ( globalId.x + hitQueueSize[ 0 ] );
				if ( hitIndex >= hitQueueSize[ 1 ] ) {

					return;

				}

				// get the ray info
				let ACTIVE_FLAG = 0xF0000000u;
				let input = hitQueue[ hitIndex ];
				let indexUV = vec2u( input.pixel_x, input.pixel_y );

				g_state.s0 = input.pcgStateS0;

				let object = transforms[ input.objectIndex ];
				var material = materials[ object.materialIndex ];

				// apply per-object colors
				material.color *= object.color.rgb;
				material.opacity *= object.color.a;

				var vertexData = ${ sampleTrianglePointFn }( input.barycoord, input.indices.xyz );
				vertexData.normal = normalize( transpose( object.inverseMatrixWorld ) * vertexData.normal );
				vertexData.position = object.matrixWorld * vertexData.position;

				let surface = ${ getSurfaceRecordFunc }( material, vertexData, input.side, input.normal, textures, textureSampler );

				let scatterRec = ${ lambertBsdfFunc }( input.view, surface );

				if ( input.currentBounce >= bounces ) {

					// terminate ray, write color
					let sampleCount = ( textureLoad( ${ params.sampleCountTarget }, indexUV ).r & ( ~ ACTIVE_FLAG ) ) + 1;
					let prevColor = textureLoad( ${ params.prevOutputTarget }, indexUV );
					let compensation = ${ unpackCompensationFn }( textureLoad( ${ params.compensationTarget }, indexUV ).r, prevColor );
					let blendedColor = ${ weightedAlphaBlendFn }( prevColor + compensation, vec4f( 0, 0, 0, 1 ), 1.0 / f32( sampleCount ) );
					let storedColor = quantizeToF16( blendedColor );
					textureStore( ${ params.sampleCountTarget }, indexUV, vec4( sampleCount ) );
					textureStore( ${ params.outputTarget }, indexUV, storedColor );
					textureStore( ${ params.compensationTarget }, indexUV, vec4u( ${ packCompensationFn }( blendedColor - storedColor, storedColor ) ) );

				} else {

					let rayQueueCapacity = arrayLength( rayQueue );
					let index = atomicAdd( &rayQueueSize[ 1 ], 1 ) % rayQueueCapacity;
					rayQueue[ index ].origin = vertexData.position.xyz;
					rayQueue[ index ].direction = scatterRec.direction;
					rayQueue[ index ].pixel = indexUV;
					rayQueue[ index ].throughputColor = input.throughputColor * scatterRec.color / scatterRec.pdf;
					rayQueue[ index ].currentBounce = input.currentBounce + 1;
					rayQueue[ index ].pcgStateS0 = g_state.s0;

				}

			}`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
