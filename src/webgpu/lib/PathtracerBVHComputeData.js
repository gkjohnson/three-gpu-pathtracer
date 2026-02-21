import { BufferAttribute, BufferGeometry, StorageBufferAttribute } from 'three/webgpu';
import { BVHComputeData } from './BVHComputeData.js';
import { wgslStruct } from './nodes/WGSLStructNode.js';
import { storage } from 'three/tsl';
import { MeshBVH, SAH } from 'three-mesh-bvh';

const transformStruct = wgslStruct( 'TransformStruct', {
	matrixWorld: 'mat4x4f',
	inverseMatrixWorld: 'mat4x4f',
	nodeOffset: 'uint',
	materialIndex: 'uint',
	_alignment0: 'uint',
	_alignment1: 'uint',
} );

const materialStruct = wgslStruct( 'MaterialStruct', {
	albedo: 'vec3f',
} );

export class PathtracerBVHComputeData extends BVHComputeData {

	constructor( ...args ) {

		super( ...args );

		this.structs.transform = transformStruct;
		this.structs.material = materialStruct;
		this.materials = [];
		this.bvhMap = new Map();

	}

	update() {

		super.update();

		const { materials, structs, name } = this;
		const materialBuffer = new ArrayBuffer( structs.material.getLength() * materials.length * 4 );
		const materialBufferF32 = new Float32Array( materialBuffer );
		materials.forEach( ( mat, i ) => {

			mat.color.toArray( materialBufferF32, i * structs.material.getLength() );

		} );

		const materialStorage = storage( new StorageBufferAttribute( new Uint32Array( materialBuffer ), 8 ), structs.material.name ).toReadOnly().setName( `${ name }materials` );
		this.storage.materials = materialStorage;

		this.bvhMap.clear();
		this.materials.length = 0;

	}

	writeTransformData( info, premultiplyMatrix, writeOffset, targetBuffer ) {

		super.writeTransformData( info, premultiplyMatrix, writeOffset, targetBuffer );

		const { materials } = this;
		const material = info.object.material;
		if ( ! materials.includes( material ) ) {

			materials.push( material );

		}

		const index = materials.indexOf( material );
		const transformBufferU32 = new Uint32Array( targetBuffer );
		transformBufferU32[ writeOffset * transformStruct.getLength() + 33 ] = index;

	}

	getBVH( object, instanceId, rangeTarget ) {

		const { bvhMap } = this;
		const bvh = super.getBVH( object, instanceId, rangeTarget );
		if ( bvhMap.has( bvh ) ) {

			const data = bvhMap.get( bvh );
			Object.assign( rangeTarget, data.range );
			return data.bvh;

		} else if ( bvh.indirect ) {

			const proxyGeometry = new BufferGeometry();
			proxyGeometry.attributes = bvh.geometry.attributes;

			let array;
			if ( bvh.geometry.index ) {

				array = bvh.geometry.index.array.slice( rangeTarget.start, rangeTarget.count + rangeTarget.start );

			} else {

				const { start, count } = rangeTarget;
				array = new Uint32Array( count );
				for ( let i = 0, l = rangeTarget.count; i < l; i ++ ) {

					array[ i ] = start + i;

				}

			}

			proxyGeometry.index = new BufferAttribute( array, 1 );
			rangeTarget.start = 0;

			// TODO: need to handle SkinnedMeshBVH here
			const newBVH = new MeshBVH( proxyGeometry, { strategy: SAH, maxLeafSize: 5 } );
			bvhMap.set( bvh, { bvh: newBVH, range: { ...rangeTarget } } );
			return newBVH;

		} else {

			return bvh;

		}

	}

}
