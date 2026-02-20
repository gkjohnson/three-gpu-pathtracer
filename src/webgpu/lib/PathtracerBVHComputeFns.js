import { StorageBufferAttribute } from 'three/webgpu';
import { BVHComputeFns } from './BVHComputeFns.js';
import { wgslStruct } from './WGSLStructNode.js';
import { storage } from 'three/tsl';

const transformStruct = wgslStruct( 'TransformStruct', 36 * 4, {
	matrixWorld: 'mat4x4f',
	inverseMatrixWorld: 'mat4x4f',
	nodeOffset: 'u32',
	materialIndex: 'u32',
	_alignment0: 'u32',
	_alignment1: 'u32',
} );

const materialStruct = wgslStruct( 'MaterialStruct', 4 * 4, {
	albedo: 'vec3f',
} );

export class PathtracerBVHComputeFns extends BVHComputeFns {

	constructor( ...args ) {

		super( ...args );

		this.structs.transform = transformStruct;
		this.structs.material = materialStruct;
		this.materials = null;

		this.update();

	}

	update() {

		this.materials = [];
		super.update();

		const { materials, structs, name } = this;
		const materialBuffer = new ArrayBuffer( structs.material.byteSize * materials.length );
		const materialBufferF32 = new Float32Array( materialBuffer );
		materials.forEach( ( mat, i ) => {

			mat.color.toArray( materialBufferF32, i * structs.material.uintSize );

		} );

		const materialStorage = storage( new StorageBufferAttribute( new Uint32Array( materialBuffer ), 8 ), structs.material.name ).toReadOnly().setName( `${ name }materials` );
		this.storage.materials = materialStorage;

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
		transformBufferU32[ writeOffset * transformStruct.uintSize + 33 ] = index;

	}

}
