/** @import { Camera, Material } from 'three/webgpu' */
import { StorageBufferAttribute } from 'three/webgpu';
import { storage } from 'three/tsl';
import {
	GRAPH_OUTPUTS, createCameraUniforms, getApplyMaterialGraphFn, getRunMaterialGraphFn, updateCameraUniforms,
} from './materialGraph.wgsl.js';

/**
 * The TSL graphs of node materials, built into the kernels by three.js. Assigned to a shading model with
 * `setMaterialGraphs`, whose surface record calls the WGSL function from `getApplyFn` to replace the surface inputs a
 * material has graphs for in `GRAPH_OUTPUTS`.
 */
export class MaterialGraphs {

	constructor() {

		this.graphs = [];
		this.cameraUniforms = createCameraUniforms();

		// the graph index of each material by its index in the shading model, or -1 without graphs. At least two long
		// so TSL doesn't make it a scalar
		this.graphIndices = storage( new StorageBufferAttribute( new Int32Array( 2 ).fill( - 1 ), 1 ), 'int' )
			.toReadOnly()
			.setName( 'materialGraphIndices' );
		this.applyFn = getApplyMaterialGraphFn( getRunMaterialGraphFn( [], this.cameraUniforms ), this.graphIndices );

	}

	/**
	 * Sets the camera the graphs read, like three.js' "cameraPosition". Changing it doesn't need a rebuild.
	 *
	 * @param {Camera} camera
	 */
	updateCamera( camera ) {

		updateCameraUniforms( this.cameraUniforms, camera );

	}

	/**
	 * Collects the graphs of the materials, in the shading model's order. Returns whether they changed, so the function
	 * from `getApplyFn` did and the kernels need rebuilding. Changed uniform values don't need a rebuild.
	 *
	 * @param {Array<Material>} materials
	 * @returns {boolean}
	 */
	update( materials ) {

		const graphs = [];
		const indices = new Int32Array( Math.max( materials.length, 2 ) ).fill( - 1 );
		materials.forEach( ( material, i ) => {

			if ( ! material.isNodeMaterial ) {

				return;

			}

			const outputs = GRAPH_OUTPUTS
				.filter( ( { key } ) => material[ key ] )
				.map( output => ( { ...output, node: material[ output.key ] } ) );

			if ( outputs.length > 0 ) {

				indices[ i ] = graphs.length;
				graphs.push( { material, outputs } );

			}

		} );

		const attribute = this.graphIndices.value;
		if ( attribute.count < indices.length ) {

			attribute.dispose();
			this.graphIndices.value = new StorageBufferAttribute( indices, 1 );

		} else {

			attribute.array.set( indices );
			attribute.needsUpdate = true;

		}

		const changed = ! areGraphsEqual( graphs, this.graphs );
		this.graphs = graphs;
		if ( changed ) {

			this.applyFn = getApplyMaterialGraphFn( getRunMaterialGraphFn( graphs, this.cameraUniforms ), this.graphIndices );

		}

		return changed;

	}

	/**
	 * Returns the WGSL function applying a hit's material graphs. Get it again when `update` returns true.
	 *
	 * @returns {Function}
	 */
	getApplyFn() {

		return this.applyFn;

	}

}

// whether two lists of graphs have the same materials and outputs, with the same nodes
function areGraphsEqual( a, b ) {

	return a.length === b.length && a.every( ( { material, outputs }, i ) => {

		const other = b[ i ].outputs;
		return material === b[ i ].material && outputs.length === other.length && outputs.every( ( output, j ) => output.node === other[ j ].node && output.name === other[ j ].name );

	} );

}
