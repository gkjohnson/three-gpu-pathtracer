import { ComputeKernel } from '../ComputeKernel';
import { wgslFn, storage, textureStore, uniform, globalId } from 'three/tsl';
import { Vector2 } from 'three';
import { StorageBufferAttribute, StorageTexture } from 'three/webgpu';
import { pathStateStruct } from '../../nodes/structs.wgsl';

export class LogicKernel extends ComputeKernel {

	constructor() {

		const params = {
			outputTarget: textureStore( new StorageTexture() ).toReadWrite(),
			sampleCountTarget: textureStore( new StorageTexture() ).toReadWrite(),

			pathState: storage( new StorageBufferAttribute(), 'PathState' ),
			regeneratePathQueue: storage( new StorageBufferAttribute(), 'uint' ),
			materialEvalQueue: storage( new StorageBufferAttribute(), 'uint' ),
			queueSizes: storage( new StorageBufferAttribute(), 'uint' ).toAtomic(),

			geomMaterialIndex: storage( new StorageBufferAttribute(), 'uint' ).toReadOnly(),

			maxBounces: uniform( 1 ),
			tileOffset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			dimensions: uniform( new Vector2() ),

			globalId: globalId,
		};

		const kernel = wgslFn( /* wgsl */`

			fn logic(
				outputTarget: texture_storage_2d<rgba32float, read_write>,
				sampleCountTarget: texture_storage_2d<r32uint, read_write>,

				pathState: ptr<storage, array<PathState>, read_write>,
				regeneratePathQueue: ptr<storage, array<u32>, read_write>,
				materialEvalQueue: ptr<storage, array<u32>, read_write>,
				queueSizes: ptr<storage, array<atomic<u32>>, read_write>,

				geomMaterialIndex: ptr<storage, array<u32>, read>,

				maxBounces: u32,
				tileOffset: vec2u,
				tileSize: vec2u,
				dimensions: vec2u,

				globalId: vec3u,
			) -> void {
				let pathIndex = globalId.x;
				let state = pathState[ pathIndex ];

				let throughputColor = pathState[ pathIndex ].throughputColor;

				let currentBounce = pathState[ pathIndex ].currentBounce;
				let isLastBounce = currentBounce >= maxBounces;

				let hasMissedScene = pathState[ pathIndex ].didHit == 0;

				let isThroughputEmpty = length( throughputColor ) < 1e-4; // all( newThroughput == vec3f( 0.0 ) );

				// TODO: Russian Roulette
				// https://blogs.autodesk.com/media-and-entertainment/wp-content/uploads/sites/162/physically_based_shader_design_in_arnold.pdf						uint minBounces = 3u;

				let isTerminated = isLastBounce || hasMissedScene || isThroughputEmpty;

				if ( !isTerminated ) {

					// Enqueue material evaluation
					let newThroughput = throughputColor * pathState[ pathIndex ].color / pathState[ pathIndex ].pdf;
					pathState[ pathIndex ].throughputColor = newThroughput;
					pathState[ pathIndex ].currentBounce += 1;

					let materialIndex = geomMaterialIndex[ pathState[ pathIndex ].indices.x ];
					pathState[ pathIndex ].materialIndex = materialIndex;

					let index = atomicAdd( &queueSizes[1], 1 );
					materialEvalQueue[ index ] = pathIndex;

				} else if ( !isThroughputEmpty && !isLastBounce && hasMissedScene ) {

					// Add color contribution
					let background = vec3f( 0.5 ); // normalize( vec3f( 0.0366, 0.0813, 0.1057 ) );

					let pathTileOffset = pathState[ pathIndex ].tileOffset;
					let pixel = vec2u( pathIndex % tileSize.x, pathIndex / tileSize.x ) + pathTileOffset;

					let newThroughput = throughputColor * pathState[ pathIndex ].color / pathState[ pathIndex ].pdf;

					let resultColor = background * newThroughput;

					let prevColor = textureLoad( outputTarget, pixel ).xyz;
					let prevSampleCount = textureLoad( sampleCountTarget, pixel ).r;
					let newSampleCount = prevSampleCount + 1;
					textureStore( sampleCountTarget, pixel, vec4( newSampleCount ) );

					let newColor = ( ( prevColor.xyz * f32( prevSampleCount ) ) + resultColor ) / f32( newSampleCount );
					textureStore( outputTarget, pixel, vec4( newColor.xyz, 1.0 ) );

				}

				if ( isTerminated ) {

					// Place in a queue for regeneration
					let index = atomicAdd( &queueSizes[0], 1 );
					regeneratePathQueue[ index ] = pathIndex;

				}
			}

		`, [ pathStateStruct ] )( params );

		super( kernel );

		this.defineUniformAccessors( params );

	}

}
