import { StorageBufferAttribute } from 'three/webgpu';
import { uniform, storage, globalId } from 'three/tsl';
import { ComputeKernel } from './ComputeKernel.js';
import { wgslTagFn } from 'three-mesh-bvh/webgpu';

// Copies the first "count" elements of one storage buffer into another of the same element type,
// for carrying live state across a buffer reallocation.
export class CopyBufferKernel extends ComputeKernel {

	constructor( elementType ) {

		const params = {
			source: storage( new StorageBufferAttribute( 1, 1 ), elementType ).toReadOnly(),
			target: storage( new StorageBufferAttribute( 1, 1 ), elementType ),
			count: uniform( 0, 'uint' ),
			globalId: globalId,
		};

		const fn = wgslTagFn/* wgsl */`
			fn compute( count: u32, globalId: vec3u ) -> void {

				let index = globalId.x;
				if ( index >= count ) {

					return;

				}

				${ params.target }[ index ] = ${ params.source }[ index ];

			}
		`;

		super( fn( params ) );

		this.defineUniformAccessors( params );

	}

}
