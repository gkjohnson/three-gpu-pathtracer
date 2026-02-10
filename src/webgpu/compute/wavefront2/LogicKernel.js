import { ComputeKernel } from '../ComputeKernel';
import { wgslFn, storage, uniform, globalId } from 'three/tsl';
import { Vector2 } from 'three';
import { StorageBufferAttribute } from 'three/webgpu';
import { pathStateStruct } from '../../nodes/structs.wgsl';

export class LogicKernel extends ComputeKernel {

	constructor(
		resultBuffer = new StorageBufferAttribute(),
		sampleCountBuffer = new StorageBufferAttribute(),

		pathState = new StorageBufferAttribute(),
		regeneratePathQueue = new StorageBufferAttribute(),
		materialEvalQueue = new StorageBufferAttribute(),
		queueSizes = new StorageBufferAttribute(),

		geomMaterialIndex = new StorageBufferAttribute(),
	) {

		const params = {
			resultBuffer: storage( resultBuffer, 'vec4' ),
			sampleCountBuffer: storage( sampleCountBuffer, 'u32' ),

			pathState: storage( pathState, 'PathState' ),
			regeneratePathQueue: storage( regeneratePathQueue, 'uint' ),
			materialEvalQueue: storage( materialEvalQueue, 'uint' ),
			queueSizes: storage( queueSizes, 'uint' ).toAtomic(),

			geomMaterialIndex: storage( geomMaterialIndex, 'uint' ).toReadOnly(),

			maxBounces: uniform( 1 ),
			tileOffset: uniform( new Vector2() ),
			tileSize: uniform( new Vector2() ),
			dimensions: uniform( new Vector2() ),

			globalId: globalId,
		};

		const kernel = wgslFn( /* wgsl */`

			fn logic(
				resultBuffer: ptr<storage, array<vec4f>, read_write>,
				sampleCountBuffer: ptr<storage, array<u32>, read_write>,

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
					let background = normalize( vec3f( 0.0366, 0.0813, 0.1057 ) );

					let pathTileOffset = pathState[ pathIndex ].tileOffset;
					let pixel = vec2u( pathIndex % tileSize.x, pathIndex / tileSize.x ) + pathTileOffset;

					let newThroughput = throughputColor * pathState[ pathIndex ].color / pathState[ pathIndex ].pdf;

					let resultColor = background * newThroughput;

					let offset = pixel.x + pixel.y * dimensions.x;

					let prevColor = resultBuffer[offset];
					let prevSampleCount = sampleCountBuffer[offset];
					let newSampleCount = prevSampleCount + 1;
					sampleCountBuffer[offset] = newSampleCount;

					let newColor = ( ( prevColor.xyz * f32( prevSampleCount ) ) + resultColor ) / f32( newSampleCount );
					resultBuffer[offset] = vec4f( newColor, 1.0 );
					// resultBuffer[offset] = vec4f( resultColor, 1.0 );

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
